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

type AbstractConstructor<T, K extends any[] = any[]> = abstract new (
  ...any: K
) => T;

type ModelDefinition = {
  tableName: string;
  columns: Record<
    string,
    ColumnType | { type: ColumnType; notNull?: boolean }
  >;
};

type SelectQuery<Model extends ModelDefinition> = {
  select: Partial<
    Record<
      keyof TranslateDefinition<Model>,
      boolean
    >
  >;
  where?: Partial<
    Record<keyof TranslateDefinition<Model>, string>
  >;
  from: Pick<ModelStatic, "tableName">;
  orderBy?: Array<
    [
      keyof TranslateDefinition<Model>,
      "ASC" | "DESC",
    ]
  >;
  limit?: number;
  offset?: number;
};

export function defineModel<
  Definition extends ModelDefinition,
  ModelSchema = TranslateDefinition<Definition>,
>(
  modelName: string,
  modelDefinition: Definition,
) {
  class Model {
    static modelName: string = modelName;
    static tableName: string = modelDefinition.tableName;
    static modelDefinition: Definition = modelDefinition;
    private dataValues: ModelSchema;
    public id: number | null = null;
    #persisted: boolean = false;

    get persisted(): boolean {
      return this.#persisted;
    }

    static query<Model extends ModelDefinition>(
      queryDefinition: Omit<SelectQuery<Definition>, "from">,
    ) {
      return query({
        text: `
          SELECT
            ${Object.keys(queryDefinition.select).join(",")}
          FROM
            ${this.tableName}
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

    constructor() {
      const allColumns = ["id"].concat(
        Object.keys(Model.modelDefinition.columns),
      );

      this.dataValues = allColumns.reduce((object, key) => {
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

    private setDataValues(dataValues: ModelSchema) {
      this.dataValues = { ...this.dataValues, ...dataValues };
      return this;
    }

    static build<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      values: ModelSchema,
    ): OmitPersistence<ConcreteModel> & NonPersistedModel {
      return new this().setDataValues(
        values,
      ) as any;
    }

    static create<ConcreteModel extends typeof Model>(
      this: ConcreteModel,
      values: ModelSchema,
    ): Promise<OmitPersistence<InstanceOf<ConcreteModel>> & PersistedModel> {
      return this.build(values).save() as any;
    }

    static find<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      id: number,
    ): Promise<OmitPersistence<ConcreteModel> & PersistedModel> {
      return new this().fetchAndSetDataValues(id);
    }

    static all<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
    ): Promise<(OmitPersistence<ConcreteModel> & PersistedModel)[]> {
      return query<ModelSchema>({
        text: `
          SELECT *
          FROM ${Model.tableName}
        `,
      }).then((rows) =>
        rows.map((row) => new this().setDataValues(row))
      ) as any;
    }

    private async fetchAndSetDataValues(
      id: number,
    ): Promise<OmitPersistence<this> & PersistedModel> {
      const [dataValues] = await Model.fetchDataValues(id);
      if (dataValues === undefined) {
        throw new Error(`${Model.modelName} with id (${id}) not found`);
      }

      this.setDataValues(dataValues as any);
      this.#persisted = true;
      assertPersisted(this, Model);
      return this;
    }

    private static fetchDataValues(id: number) {
      return query({
        text: `
          SELECT *
          FROM ${Model.tableName}
          WHERE ${Model.tableName}.id = $1`,
        args: [id],
      });
    }

    async save(): Promise<OmitPersistence<this> & PersistedModel> {
      const { id: _id, ...values } = this.dataValues;
      const entries = Object.entries(values);
      const columnNames = entries.map((entry) => entry.at(0));
      const columnValues = entries.map((entry) => entry.at(1));
      const columnParameterList = columnValues.map((_k, index) =>
        `$${index + 1}`
      );

      const [row] = await query({
        text: `
          INSERT INTO ${Model.tableName}
            (${columnNames.join(",")})
            VALUES (${columnParameterList.join(",")})
          RETURNING id
        `,
        args: columnValues,
      });
      this.#persisted = true;
      Object.defineProperty(this.dataValues, "id", {
        value: (row as any).id,
        enumerable: true,
      });
      return this as any;
    }

    async reload(): Promise<OmitPersistence<this> & PersistedModel> {
      assertPersisted(this, Model);
      const [values] = await Model.fetchDataValues(this.id);
      if (!values) {
        this.#persisted = false;
        throw new Error(`${Model.modelName} is no longer persisted`);
      }
      this.setDataValues(values as any);
      return this;
    }

    async update(
      data: Partial<TranslateDefinition<Definition>>,
    ): Promise<OmitPersistence<this> & PersistedModel> {
      assertPersisted(this, Model);
      await Model.update(this.id, data);
      return await this.reload();
    }

    static async update(
      id: number | string,
      data: Partial<TranslateDefinition<Definition>>,
    ): Promise<number> {
      const set = (column: string, index: number) => `${column} = $${index}`;
      const argOffset = 2;

      const entries = Object.entries(data);
      const updatedFields = entries.map((entry) => entry.at(0) as string).map(
        (column, index) => set(column, index + argOffset), // start at 2
      ).join(",");
      const args = [id].concat(entries.map((entry) => entry.at(1) as string));

      const [row] = await query<WithId>({
        text: `
          UPDATE ${this.tableName}
          SET ${updatedFields}
          WHERE ${this.tableName}.id = $1
          RETURNING id
          `,
        args,
      });

      return row.id;
    }

    async destroy(): Promise<OmitPersistence<this> & NonPersistedModel> {
      assertPersisted(this, Model);
      await Model.destroy(this.id);
      this.#persisted = false;
      this.setDataValues({ id: null } as any);
      return this as any;
    }

    static async destroy(id: number | string): Promise<WithId> {
      const rows = await query<WithId>({
        text: `
          DELETE FROM ${this.tableName}
          WHERE ${this.tableName}.id = $1
          RETURNING id
          `,
        args: [id],
      });
      return rows[0];
    }
  }
  return Model as
    & typeof Model
    & ModelStatic
    & Constructor<TranslateDefinition<Definition> & NonPersistedModel>;
}

type TypeMap = {
  "string": string;
  "number": number;
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

function query<T>(options: QueryObjectOptions): Promise<T[]> {
  return client.queryObject<T>(options).then((result) => result.rows);
}
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
