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

function getPrimaryKeyColumn(model: ModelStatic): string {
  const primaryKey = Object.keys(model.modelDefinition.columns).find(
    (column) => {
      const definition = model.modelDefinition.columns[column];

      if (
        typeof definition === "object" && "primaryKey" in definition &&
        (definition.primaryKey) === true
      ) {
        return true;
      }
    },
  )

  if (!primaryKey) {
    throw new Error(
      `${model.modelName} model doesn't have a known primary key`,
    );
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

type InstanceOf<T> = T extends new (...any: any[]) => infer T ? T : never;

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

type Optional<T extends Record<PropertyKey, any>> = {
  [K in keyof T]?: T[K];
};

type Values<Object extends Record<any, any>> = Object extends
  { [key: PropertyKey]: infer T } ? T : never;

export function defineModel<
  Definition extends ModelDefinition,
  ModelSchema extends Record<string, any> = TranslateDefinition<Definition>,
  PrimaryKey extends Record<any, any> = GetPrimaryKey<Definition["columns"]>,
  Pk = Values<PrimaryKey>,
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
    #dataValues: ModelSchema;
    #primaryKeyProperty: string | null = null;
    #persisted: boolean = false;

    /** Getters and setters */

    get primaryKey(): Pk | null {
      if (this.#primaryKeyProperty === null) {
        return null;
      }
      return this.dataValues[this.#primaryKeyProperty];
    }

    get primaryKeyProperty(): string | null {
      return this.#primaryKeyProperty;
    }

    set primaryKeyProperty(pk: string | null) {
      this.#primaryKeyProperty = pk;
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

    public set(dataValues: Partial<ModelSchema>) {
      this.#dataValues = { ...this.#dataValues, ...dataValues };
      return this;
    }

    /** Static methods */

    constructor() {
      const allColumns = Object.entries(Model.modelDefinition.columns);

      this.#dataValues = allColumns.reduce((object, [key, value]) => {
        if (
          typeof value === "object" && "primaryKey" in value &&
          value.primaryKey === true
        ) {
          this.#primaryKeyProperty = key;
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
      columnsOrValues: Array<keyof ModelSchema>,
      queryOptions: Omit<SelectQuery<ModelSchema>, "from">,
    ): Promise<Array<InstanceOf<ConcreteModel>>> {
      const result = await select<ModelSchema>(columnsOrValues, {
        ...queryOptions,
        from: this.tableName,
      });
      return result.rows.map((row) => {
        const instance = new this().set(row);
        instance.persisted = true;
        return instance as InstanceOf<ConcreteModel>;
      });
    }

    static build<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values: Partial<ModelSchema>,
    ): InstanceOf<ConcreteModel> {
      return new this().set(
        values,
      ) as any;
    }

    static create<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values:
        & Omit<ModelSchema, keyof PrimaryKey>
        & Optional<PrimaryKey>,
    ): Promise<InstanceOf<ConcreteModel>> {
      return this.build(values).save();
    }

    static async findByPk<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      primaryKey: Pk,
      columnsOrValues: Array<keyof ModelSchema> = Object.keys(
        this.modelDefinition.columns,
      ),
    ): Promise<InstanceOf<ConcreteModel>> {
      if (primaryKey === null || typeof primaryKey === "undefined") {
        throw new Error(`${primaryKey} is not a valid identifier`);
      }
      const result = await this.select(columnsOrValues, {
        where: {
          [getPrimaryKeyColumn(this)]: primaryKey,
        } as unknown as ModelSchema,
      });
      const modelInstance = result[0];
      if (!modelInstance) {
        throw new Error("Not found");
      }
      return modelInstance;
    }

    static async update(
      id: Pk,
      data: Partial<ModelSchema>,
    ): Promise<number> {
      const set = (column: string, index: number) => `${column} = $${index}`;
      const argOffset = 2;

      const entries = Object.entries(data);
      const updatedFields = entries.map((entry) => entry.at(0) as string).map(
        (column, index) => set(column, index + argOffset), // start at 2
      ).join(",");
      const args = [id].concat(entries.map((entry) => entry.at(1)));

      const [row] = await client!.queryObject<WithId>({
        text: `
          UPDATE ${this.tableName}
          SET ${updatedFields}
          WHERE ${this.tableName}.id = $1
          RETURNING id
          `,
        args,
      }).then((result) => result.rows);

      return row.id;
    }

    static async destroy(id: Pk): Promise<WithId> {
      const rows = await client!.queryObject<WithId>({
        text: `
          DELETE FROM ${this.tableName}
          WHERE ${this.tableName}.id = $1
          RETURNING id
          `,
        args: [id],
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
      const clone = await Model.findByPk(this.primaryKey!);
      this.set(clone.dataValues);
      return this;
    }

    async update(
      data: Partial<ModelSchema>,
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
    & Constructor<ModelSchema>;
}

type TypeMap = {
  "string": string;
  "uuid": string;
  "integer": number;
  "boolean": boolean;
  [dataType: `date${string | undefined}`]: Date;
  "timestamp": Date;
};

type ColumnType = keyof TypeMap;

type TranslateDefinition<
  Definition extends ModelDefinition,
  Columns = Definition["columns"],
> = {
  [Col in keyof Columns]: Columns[Col] extends ColumnType
    ? GetOptionality<Columns[Col], TypeMap[Columns[Col]]>
    : Columns[Col] extends { type: ColumnType }
      ? GetOptionality<Columns[Col], TypeMap[Columns[Col]["type"]]>
    : "Unsupported data type";
};

type GetOptionality<
  Column extends ColumnDefinition | ColumnType,
  Type,
> = Column extends { notNull: true } | { primaryKey: true } ? Type
  : Type | null;

type Something = GetOptionality<"integer", string>;

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
