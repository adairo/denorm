// deno-lint-ignore-file no-explicit-any
import type { QueryObjectOptions } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import client from "./db.ts";

function assertPersisted(
  instance: UnknownPersistedModel,
  model: ModelStatic,
): asserts instance is PersistedModel {
  if (instance.id === null || !instance.persisted) {
    const modelName = model.modelName;
    throw new Error(
      `This ${modelName} model instance is not persisted yet, did you call ${modelName}.save() first?`,
    );
  }
}

type WithId = { id: number };
type UnknownPersistedModel = { id: number | null; persisted: boolean };
type OmitPersistence<Model extends { id: any; persisted: any }> = Omit<
  Model,
  "id" | "persisted"
>;
type PersistedModel = {
  id: number;
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
  columns: Record<
    string,
    ColumnType | {
      type: ColumnType;
      notNull?: boolean;
      primaryKey?: boolean;
      references?: ModelStatic;
    }
  >;
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
  return client.queryObject<Partial<Columns>>({
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

type User = { first_name: string; last_name: string };

select<User>(["first_name"], {
  from: "users",
  where: {
    first_name: "12",
  },
  orderBy: [["first_name", "ASC"]],
});

export function defineModel<
  Definition extends ModelDefinition,
  ModelSchema extends Record<string, any> =
    & TranslateDefinition<Definition>
    & WithId,
>(
  modelName: string,
  modelDefinition: Definition,
) {
  class Model {
    static modelName: string = modelName;
    static tableName: string = modelDefinition.tableName;
    static modelDefinition: Definition = modelDefinition;
    #dataValues: ModelSchema;
    public id: number | null = null;
    #persisted: boolean = false;

    get persisted(): boolean {
      return this.#persisted;
    }

    get dataValues() {
      return this.#dataValues;
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
      return result.rows.map((row) =>
        new this().set(row).setPersisted(true)
      ) as any;
    }

    private setPersisted(persisted: boolean) {
      this.#persisted = persisted;
      return this;
    }

    constructor() {
      const allColumns = ["id"].concat(
        Object.keys(Model.modelDefinition.columns),
      );

      this.#dataValues = allColumns.reduce((object, key) => {
        Object.defineProperty(object, key, {
          value: null,
          enumerable: true,
          writable: true,
        });
        return object;
      }, Object.create(null));

      allColumns.forEach((
        columnKey,
      ) =>
        Object.defineProperty(this, columnKey, {
          get() {
            return this.dataValues[columnKey];
          },
        })
      );
    }

    static build<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values: Partial<ModelSchema>,
    ): OmitPersistence<InstanceOf<ConcreteModel>> & NonPersistedModel {
      return new this().set(
        values,
      ) as any;
    }

    public set(dataValues: Partial<ModelSchema>) {
      this.#dataValues = { ...this.#dataValues, ...dataValues };
      return this;
    }

    static create<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values: ModelSchema,
    ): Promise<OmitPersistence<InstanceOf<ConcreteModel>> & PersistedModel> {
      return this.build(values).save() as any;
    }

    static find<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      id: number,
      columnsOrValues: Array<keyof ModelSchema> = Object.keys(
        this.modelDefinition.columns,
      ),
    ): Promise<OmitPersistence<InstanceOf<ConcreteModel>> & PersistedModel> {
      if (id === null || typeof id === "undefined") {
        throw new Error(`${id} is not a valid identifier`);
      }
      return this.select(columnsOrValues, {
        where: { id } as unknown as ModelSchema,
      }).then((result) => {
        const modelInstance = result[0];
        if (!modelInstance) {
          throw new Error("Not found");
        }

        return modelInstance;
      }) as any;
    }

    async save(): Promise<OmitPersistence<this> & PersistedModel> {
      const { id: _id, ...values } = this.#dataValues;
      const entries = Object.entries(values);
      const columnNames = entries.map((entry) => entry.at(0));
      const columnValues = entries.map((entry) => entry.at(1));
      const columnParameterList = columnValues.map((_k, index) =>
        `$${index + 1}`
      );

      const [row] = await client.queryObject<WithId>({
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

    async reload(): Promise<OmitPersistence<this> & PersistedModel> {
      assertPersisted(this, Model);
      const clone = await Model.find(this.id);
      this.set(clone.dataValues);
      return this;
    }

    async update(
      data: Partial<ModelSchema>,
    ): Promise<OmitPersistence<this> & PersistedModel> {
      assertPersisted(this, Model);
      await Model.update(this.id, data);
      return await this.reload();
    }

    static async update(
      id: number | string,
      data: Partial<ModelSchema>,
    ): Promise<number> {
      const set = (column: string, index: number) => `${column} = $${index}`;
      const argOffset = 2;

      const entries = Object.entries(data);
      const updatedFields = entries.map((entry) => entry.at(0) as string).map(
        (column, index) => set(column, index + argOffset), // start at 2
      ).join(",");
      const args = [id].concat(entries.map((entry) => entry.at(1) as string));

      const [row] = await client.queryObject<WithId>({
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

    async destroy(): Promise<this> {
      assertPersisted(this, Model);
      await Model.destroy(this.id);
      this.#persisted = false;
      this.set({ id: null } as any);
      return this as any;
    }

    static async destroy(id: number | string): Promise<WithId> {
      const rows = await client.queryObject<WithId>({
        text: `
          DELETE FROM ${this.tableName}
          WHERE ${this.tableName}.id = $1
          RETURNING id
          `,
        args: [id],
      }).then((result) => result.rows);
      return rows[0];
    }
  }
  return Model as
    & typeof Model
    & ModelStatic
    & Constructor<ModelSchema>;
}

type TypeMap = {
  "string": string;
  "integer": number;
  "boolean": boolean;
  [dataType: `date${string | undefined}`]: Date;
  "timestamp": Date;
};

type ColumnType = keyof TypeMap;

type TranslateDefinition<Definition extends ModelDefinition> = {
  [Col in keyof Definition["columns"]]: Definition["columns"][Col] extends
    ColumnType ? TypeMap[Definition["columns"][Col]]
    : Definition["columns"][Col] extends { type: ColumnType }
      ? TypeMap[Definition["columns"][Col]["type"]]
    : "TIPO raro fuchi";
};
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
