// deno-lint-ignore-file no-explicit-any

import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import {
  insertInto,
  type InsertQuery,
  select,
  type SelectQuery,
  update,
  type UpdateQuery,
} from "./queries.ts";

let client: Client | undefined;

function assertPersisted(
  instance: any,
  model: ModelStatic,
): void {
  if (instance.primaryKey === null || !instance.persisted) {
    throw new Error(
      `This ${model.modelName} model instance is not persisted yet, did you call ${model.modelName}.save() first?`,
    );
  }
}

function getPrimaryKeyColumn(columns: ModelColumns): string | null {
  const primaryKey = Object.keys(columns).find(
    (column) => {
      const definition = columns[column];

      if (
        typeof definition === "object" && "primaryKey" in definition &&
        (definition.primaryKey) === true
      ) {
        return true;
      }
    },
  );

  if (!primaryKey) {
    return null;
  }

  return primaryKey;
}

type WithId = { id: number };
type UnknownPersistedModel = {
  primaryKey: string | number | null;
  persisted: boolean;
};
type OmitPersistence<Model extends { primaryKey: any; persisted: any }> = Omit<
  Model,
  "id" | "persisted"
>;
type PersistedModel = {
  primaryKey: string | number;
  persisted: true;
};
type NonPersistedModel = { id: null; persisted: false };

type ModelStatic = {
  tableName: string;
  modelName: string;
  modelDefinition: ModelDefinition;
};

type Constructor<T, K extends any[] = any[]> = new (
  ...any: K
) => T;

type ModelDefinition = {
  tableName: string;
  columns: ModelColumns;
};

type ModelColumns = Record<
  string,
  ColumnType | ColumnDefinition
>;

type ColumnDefinition = {
  type: ColumnType;
  notNull?: boolean;
  primaryKey?: boolean;
  references?: ModelStatic;
};

type GetPrimaryKey<Columns extends ModelDefinition["columns"]> = {
  [
    Key in keyof Columns as Columns[Key] extends ColumnDefinition
      ? Columns[Key]["primaryKey"] extends true ? Key : never
      : never
  ]: Columns[Key] extends ColumnDefinition ? TypeMap[Columns[Key]["type"]]
    : never;
};

type ValuesOf<Object extends Record<any, any>> = Object extends
  { [key: PropertyKey]: infer T } ? T : never;

export function defineModel<
  Definition extends ModelDefinition,
  Schema extends Record<string, any> = ModelSchema<Definition>,
  PrimaryKey extends Record<any, any> = GetPrimaryKey<Definition["columns"]>,
  Pk = ValuesOf<PrimaryKey>,
>(
  modelName: string,
  modelDefinition: Definition,
  _client?: Client,
) {
  client = _client;
  class Model {
    static modelName: string = modelName;
    static tableName: string = modelDefinition.tableName;
    static modelDefinition: Definition = modelDefinition;
    #dataValues: Schema;
    #primaryKeyColumn: string | null = null;
    #persisted: boolean = false;

    /** Getters and setters */

    get primaryKey(): Pk | null {
      if (this.#primaryKeyColumn === null) {
        return null;
      }
      return this.dataValues[this.#primaryKeyColumn];
    }

    get primaryKeyProperty(): string | null {
      return this.#primaryKeyColumn;
    }

    set primaryKeyProperty(pk: string | null) {
      this.#primaryKeyColumn = pk;
    }

    get persisted(): boolean {
      return this.#persisted;
    }

    private set persisted(persisted: boolean) {
      this.#persisted = persisted;
    }

    get dataValues() {
      return this.#dataValues;
    }

    public set(dataValues: Partial<Schema>) {
      const modelColumns = Model.columns();
      this.#dataValues = Object.keys(dataValues).reduce((values, column) => {
        if (modelColumns.includes(column)) {
          (values[column] as any) = dataValues[column];
        }
        return values;
      }, { ...this.#dataValues });
      return this;
    }

    /** Static members */

    static primaryKeyColumn = getPrimaryKeyColumn(this.modelDefinition.columns);

    constructor() {
      const allColumns = Object.keys(Model.modelDefinition.columns);

      this.#primaryKeyColumn = getPrimaryKeyColumn(
        Model.modelDefinition.columns,
      );
      this.#dataValues = allColumns.reduce((object, column) => {
        Object.defineProperty(object, column, {
          value: null,
          enumerable: true,
          writable: false,
        });
        return object;
      }, Object.create(null));

      allColumns.forEach((column) =>
        Object.defineProperty(this, column, {
          get() {
            return this.dataValues[column];
          },
          enumerable: true,
        })
      );
    }

    static columns() {
      return Object.keys(this.modelDefinition.columns);
    }

    static async select<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      columnsOrValues: Array<keyof Schema>,
      queryOptions: Omit<SelectQuery<Schema>, "from">,
    ): Promise<Array<InstanceType<ConcreteModel>>> {
      const result = await select<Schema>(columnsOrValues, {
        ...queryOptions,
        from: this.tableName,
      }, client!);
      return result.rows.map((row) => {
        const instance = new this().set(row);
        instance.persisted = true;
        return instance as InstanceType<ConcreteModel>;
      });
    }

    static build<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values: Partial<Schema> = {},
    ): InstanceType<ConcreteModel> {
      return new this().set(
        values,
      ) as any;
    }

    static create<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values:
        & Omit<Schema, keyof PrimaryKey>
        & Partial<PrimaryKey>,
    ): Promise<InstanceType<ConcreteModel>> {
      return this.build(values).save();
    }

    static async find<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      primaryKey: Pk,
      columnsOrValues: Array<keyof Schema> = Object.keys(
        this.modelDefinition.columns,
      ),
    ): Promise<InstanceType<ConcreteModel>> {
      if (primaryKey === null || typeof primaryKey === "undefined") {
        throw new Error(`${primaryKey} is not a valid identifier`);
      }
      const primaryKeyColumn = getPrimaryKeyColumn(
        this.modelDefinition.columns,
      );
      if (!primaryKeyColumn) {
        throw new Error(
          `${this.modelName} model doesn't have a known primary key`,
        );
      }
      const result = await this.select(columnsOrValues, {
        where: {
          [primaryKeyColumn]: primaryKey,
        } as unknown as Schema,
        limit: 1,
      });
      const modelInstance = result[0];
      if (!modelInstance) {
        throw new Error(
          `${this.modelName} with ${primaryKeyColumn}=${primaryKey} does not exist`,
        );
      }
      return modelInstance;
    }

    static update(
      query: UpdateQuery<Partial<Schema>>,
    ): Promise<any> {
      return update(this.tableName, query, client!);
    }

    static async delete(primaryKey: Pk): Promise<Pk> {
      const rows = await client!.queryObject<PrimaryKey>({
        text: `
          DELETE FROM ${this.tableName}
          WHERE ${this.tableName}.${this.primaryKeyColumn} = $1
          RETURNING ${this.primaryKeyColumn}
          `,
        args: [primaryKey],
      }).then((result) => result.rows);
      const [result] = rows;

      if (!result) {
        throw new Error(
          `${this.modelName} with ${this.primaryKeyColumn}=${primaryKey} was not deleted because it was not found`,
        );
      }

      return result[this.primaryKeyColumn as any];
    }

    static insert<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      query: {
        values:
          & Omit<Schema, keyof PrimaryKey>
          & Partial<PrimaryKey>;
      },
    ): Promise<InstanceType<ConcreteModel>> {
      return new this().set(query.values).save() as any
    }

    /** Public instance methods */

    async save(): Promise<this> {
      if (!Model.primaryKeyColumn) {
        throw new Error("Model doesnt have a known pk");
      }

      const [result] = await insertInto<PrimaryKey>(Model.tableName, {
        values: this.#dataValues,
        returning: Model.primaryKeyColumn,
      }, client!);

      this.set(result);
      this.#persisted = true;
      return this;
    }

    async reload(): Promise<this> {
      assertPersisted(this, Model);
      const clone = await Model.find(this.primaryKey!);
      this.set(clone.dataValues);
      return this;
    }

    async update(
      data: Partial<Schema>,
    ): Promise<this> {
      assertPersisted(this, Model);
      this.set(data);
      await Model.update({
        set: data,
        where: { [this.primaryKeyProperty as any]: this.primaryKey },
      });
      return this;
    }

    async delete(): Promise<this> {
      assertPersisted(this, Model);
      await Model.delete(this.primaryKey!);
      this.#persisted = false;
      this.set({ id: null } as any);
      return this as any;
    }

    toJSON() {
      return JSON.stringify(this.#dataValues);
    }
  }
  return Model as
    & typeof Model
    & ModelStatic
    & Constructor<Schema>;
}

type TypeMap = {
  "text": string;
  "uuid": string;
  "integer": number;
  "boolean": boolean;
  [dataType: `date${string | undefined}`]: Date;
  [dataType: `timestamp${string | undefined}`]: Date;
};

type ColumnType = keyof TypeMap;

type ModelSchema<
  Definition extends ModelDefinition,
  Columns = Definition["columns"],
> = {
  [Col in keyof Columns]: Columns[Col] extends ColumnType
    ? Optionality<Columns[Col], TypeMap[Columns[Col]]>
    : Columns[Col] extends { type: ColumnType }
      ? Optionality<Columns[Col], TypeMap[Columns[Col]["type"]]>
    : "Unsupported data type";
};

type Optionality<
  Column extends ColumnDefinition | ColumnType,
  Type,
> = Column extends { notNull: true } | { primaryKey: true } ? Type
  : Type | null;

/* class ORM<TMap extends ModelMap = {}> {
  models: TMap = {} as TMap;
  defineModel<
    TName extends string,
    TModelDefinition extends ModelDefinition,
  >(
    modelName: TName,
    modelDefinition: TModelDefinition,
  ): ORM<TMap & Record<TName, Model<TModelDefinition>>> {
    this.models[modelName] = createModel<TModelDefinition>(
      modelName,
      modelDefinition,
    ) as any;
    return this as any;
  }
}
 */

/* interface Model<Definition extends ModelDefinition = { columns: {} }> {
  new (dataValues: Partial<Definition["columns"]>): {};
  readonly modelName: string;
  build(
    values: Partial<TranslateDefinition<Definition>>,
  ): ReturnType<typeof createModel>;
} */
