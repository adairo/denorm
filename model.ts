// deno-lint-ignore-file no-explicit-any

import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

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

type SelectQuery<Model extends Record<string, any>> = {
  where?: Partial<
    Record<keyof Model, any>
  >;
  from: string;
  orderBy?: Array<
    [
      keyof Model,
      "ASC" | "DESC",
    ]
  >;
  limit?: number;
  offset?: number;
};

export function select<
  Columns extends Record<string, any>,
>(
  columnsOrValues: Array<keyof Columns>,
  queryDefinition: SelectQuery<Columns>,
) {
  return client!.queryObject<Partial<Columns>>({
    text: `
      SELECT
        ${columnsOrValues.join(",")}
      FROM
        ${queryDefinition.from}
        ${
      queryDefinition.where
        ? `WHERE
        ${
          Object.entries(queryDefinition.where ?? {}).map(([col, value]) =>
            `${col} = '${value}'`
          )
            .join(" AND ")
        }`
        : ""
    }
    ${
      queryDefinition.orderBy
        ? ` ORDER BY ${
          queryDefinition.orderBy.map(([col, order]) =>
            `${String(col)} ${order}`
          ).join(", ")
        }`
        : ""
    }
      
     ${queryDefinition.limit ? `LIMIT ${queryDefinition.limit}` : ""}
    `,
  });
}

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
      this.#dataValues = { ...this.#dataValues, ...dataValues };
      return this;
    }

    /** Static members */

    static primaryKeyColumn = getPrimaryKeyColumn(this.modelDefinition.columns);

    constructor() {
      const allColumns = Object.entries(Model.modelDefinition.columns);

      this.#primaryKeyColumn = getPrimaryKeyColumn(modelDefinition.columns);
      this.#dataValues = allColumns.reduce((object, [key, value]) => {
        if (
          typeof value === "object" && "primaryKey" in value &&
          value.primaryKey === true
        ) {
          this.#primaryKeyColumn = key;
        }
        Object.defineProperty(object, key, {
          value: null,
          enumerable: true,
          writable: true,
        });
        return object;
      }, Object.create(null));

      allColumns.forEach((
        [columnKey],
      ) =>
        Object.defineProperty(this, columnKey, {
          get() {
            return this.dataValues[columnKey];
          },
          enumerable: true,
        })
      );
    }

    static async select<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      columnsOrValues: Array<keyof Schema>,
      queryOptions: Omit<SelectQuery<Schema>, "from">,
    ): Promise<Array<InstanceType<ConcreteModel>>> {
      const result = await select<Schema>(columnsOrValues, {
        ...queryOptions,
        from: this.tableName,
      });
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

    static async update(
      primaryKey: Pk,
      data: Partial<Schema>,
    ): Promise<number> {
      const set = (column: string, index: number) => `${column} = $${index}`;
      const argOffset = 2;

      const entries = Object.entries(data);
      const updatedFields = entries.map((entry) => entry.at(0) as string).map(
        (column, index) => set(column, index + argOffset), // start at 2
      ).join(",");
      const args = [primaryKey].concat(entries.map((entry) => entry.at(1)));

      const [row] = await client!.queryObject<WithId>({
        text: `
          UPDATE ${this.tableName}
          SET ${updatedFields}
          WHERE ${this.tableName}.${this.primaryKeyColumn} = $1
          RETURNING ${this.primaryKeyColumn}
          `,
        args,
      }).then((result) => result.rows);

      return row.id;
    }

    static async destroy(primaryKey: Pk): Promise<WithId> {
      const rows = await client!.queryObject<WithId>({
        text: `
          DELETE FROM ${this.tableName}
          WHERE ${this.tableName}.${this} = $1
          RETURNING id
          `,
        args: [primaryKey],
      }).then((result) => result.rows);
      return rows[0];
    }

    /** Public instance methods */

    async save(): Promise<this> {
      const { id: _id, ...values } = this.#dataValues;
      const entries = Object.entries(values);
      const columnNames = entries.map((entry) => entry.at(0));
      const columnValues = entries.map((entry) => entry.at(1));
      const columnParameterList = columnValues.map((_k, index) =>
        `$${index + 1}`
      );

      const [row] = await client!.queryObject<WithId>({
        text: `
          INSERT INTO ${Model.tableName}
            (${columnNames.join(",")})
            VALUES (${columnParameterList.join(",")})
          RETURNING id
        `,
        args: columnValues,
      }).then((result) => result.rows);

      this.#persisted = true;
      Object.defineProperty(this.#dataValues, "id", {
        value: row.id,
        enumerable: true,
      });
      return this as any;
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
      await Model.update(this.primaryKey!, data);
      return await this.reload();
    }

    async destroy(): Promise<this> {
      assertPersisted(this, Model);
      await Model.destroy(this.primaryKey!);
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
