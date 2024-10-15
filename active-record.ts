// deno-lint-ignore-file no-explicit-any
import type { QueryObjectOptions } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import client from "./db.ts";

/*

  static update(id: number | string, data: Record<string, string | number>) {
    const set = (column: string, index: number) => `${column} = $${index}`;
    const argOffset = 2;

    const entries = Object.entries(data);
    const updatedFields = entries.map((entry) => entry.at(0) as string).map(
      (column, index) => set(column, index + argOffset), // start at 2
    ).join(",");
    const args = [id].concat(entries.map((entry) => entry.at(1) as string));

    return this.query({
      text: `
        UPDATE ${this.tableName}
        SET ${updatedFields}
        WHERE ${this.tableName}.id = $1
        RETURNING *`,
      args,
    });
  }

  static delete(id: number | string) {
    return this.query({
      text: `
        DELETE FROM ${this.tableName}
        WHERE ${this.tableName}.id = $1`,
      args: [id],
    });
  }

  static init<T extends ModelMap>(
    columnMap: T,
    options?: { tableName?: string },
  ) {
    this.columnMap = columnMap;
    this.tableName = options?.tableName ?? this.name; // class name
  }
} */

function assertPersisted(
  model: any,
): asserts model is PersistedModel {
  if (!("id" in model) || !model.persisted) {
    throw new Error(
      `This ${model.modelName} instance is not persisted yet, did you forget to call Model.save() first?`,
    );
  }
}

type WithId = { id: number };
type PersistedModel = { id: number; persisted: true };

type ModelStatic = {
  tableName: string;
  modelName: string;
  modelDefinition: ModelDefinition;
};

type Constructor<T, K extends any[] = any[]> = new (
  ...any: K
) => T;

type AbstractConstructor<T, K extends any[] = any[]> = abstract new (
  ...any: K
) => T;

export function defineModel<Definition extends ModelDefinition>(
  modelName: string,
  modelDefinition: Definition,
) {
  class Model {
    static modelName: string = modelName;
    static tableName: string = modelDefinition.tableName;
    static modelDefinition: Definition = modelDefinition;
    private dataValues: Record<string, any>;
    public id: number | null = null;
    #persisted: boolean = false;

    get persisted(): boolean {
      return this.#persisted;
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

    protected setDataValues(dataValues: TranslateDefinition<Definition>) {
      Object.assign(this.dataValues, dataValues);
      return this;
    }

    static build<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      values: TranslateDefinition<Definition>,
    ): ConcreteModel {
      return new this().setDataValues(
        values,
      ) as any;
    }

    static create<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      values: TranslateDefinition<Definition>,
    ) {
      return Model.build(values).save();
    }

    static find<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      id: number,
    ): Promise<ConcreteModel & PersistedModel> {
      return new this().fetchAndSetDataValues(id);
    }

    private async fetchAndSetDataValues(
      id: number,
    ): Promise<this & PersistedModel> {
      const [dataValues] = await Model.fetchDataValues(id);
      if (dataValues === undefined) {
        throw new Error(`${Model.modelName} with id (${id}) not found`);
      }

      this.setDataValues(dataValues as any);
      this.#persisted = true;
      assertPersisted(this);
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

    async save(): Promise<this & PersistedModel> {
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

    async reload(): Promise<this & PersistedModel> {
      assertPersisted(this);
      const [values] = await Model.fetchDataValues(this.id);
      if (!values){
        this.#persisted = false;
        throw new Error(`${Model.modelName} is no longer persisted`)
      }
      this.setDataValues(values as any);
      return this;
    }

    async update(
      data: Partial<TranslateDefinition<Definition>>,
    ): Promise<this & PersistedModel> {
      assertPersisted(this);
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
    & Constructor<TranslateDefinition<Definition>>;
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

type ModelDefinition = {
  tableName: string;
  columns: Record<
    string,
    ColumnType | { type: ColumnType; notNull?: boolean }
  >;
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
