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
): asserts model is { id: number } {
  if (!("id" in model)) {
    throw new Error(
      `This ${model.modelName} instance is not persisted yet, did you forget to call Model.save() first?`,
    );
  }
}

type WithId = { id: number };

type ModelConstructor<Model, Definition extends ModelDefinition> =
  & Model
  & Constructor<
    TranslateDefinition<Definition>
  >;

type Constructor<T> = new (...args: any[]) => T;

export function createModel<Definition extends ModelDefinition>(
  modelName: string,
  modelDefinition: Definition,
) {
  class Model {
    static modelName: string = modelName;
    static tableName: string = modelDefinition.tableName;
    static modelDefinition: Definition = modelDefinition;
    private dataValues: Record<string, any>;

    constructor() {
      this.dataValues = Object.create(null);

      ["id"].concat(Object.keys(Model.modelDefinition.columns)).forEach((
        columnKey,
      ) =>
        Object.defineProperty(this, columnKey, {
          get() {
            return this.dataValues[columnKey] ?? null;
          },
          enumerable: true,
          configurable: true,
        })
      );
    }

    protected setDataValues(dataValues: TranslateDefinition<Definition>) {
      this.dataValues = { ...dataValues };
      return this;
    }

    static build<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      values: TranslateDefinition<Definition>,
    ): ConcreteModel {
      return new this().setDataValues(
        Object.assign({ id: null }, values),
      ) as any;
    }

    static create<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      values: TranslateDefinition<Definition>,
    ): Promise<ConcreteModel> {
      return Model.build(values).save() as any;
    }

    static async find<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      id: number,
    ): Promise<ConcreteModel & { id: number }> {
      const [row] = await Model.fetchDataValues(id);
      if (row === null) {
        throw new Error(`${Model.modelName} with id <${id}> not found`);
      }

      return new this().setDataValues(row as any) as any;
    }

    protected static fetchDataValues(id: number) {
      return query({
        text: `
          SELECT *
          FROM ${Model.tableName}
          WHERE ${Model.tableName}.id = $1`,
        args: [id],
      });
    }

    // Make return as Model & {id: number}
    save(): Promise<this> {
      const { id: _id, ...values } = this.dataValues;
      const entries = Object.entries(values);
      const columnNames = entries.map((entry) => entry.at(0));
      const columnValues = entries.map((entry) => entry.at(1));
      const columnParameterList = columnValues.map((_k, index) =>
        `$${index + 1}`
      );

      return query({
        text: `
          INSERT INTO ${Model.tableName}
            (${columnNames.join(",")})
            VALUES (${columnParameterList.join(",")})
          RETURNING id
        `,
        args: columnValues,
      }).then(([row]) =>
        Object.defineProperty(this.dataValues, "id", {
          value: (row as any).id,
          enumerable: true,
        })
      ).then(() => this);
    }

    reload() {
      assertPersisted(this);
      return Model.fetchDataValues(this.id).then(([values]) =>
        this.setDataValues(values as any)
      ).then(() => this);
    }

    update(data: Partial<TranslateDefinition<Definition>>): Promise<WithId> {
      assertPersisted(this);
      return Model.update(this.id, data).then(() => this.reload());
    }

    static update(
      id: number | string,
      data: Partial<TranslateDefinition<Definition>>,
    ): Promise<WithId> {
      const set = (column: string, index: number) => `${column} = $${index}`;
      const argOffset = 2;

      const entries = Object.entries(data);
      const updatedFields = entries.map((entry) => entry.at(0) as string).map(
        (column, index) => set(column, index + argOffset), // start at 2
      ).join(",");
      const args = [id].concat(entries.map((entry) => entry.at(1) as string));

      return query({
        text: `
          UPDATE ${this.tableName}
          SET ${updatedFields}
          WHERE ${this.tableName}.id = $1
          RETURNING id
          `,
        args,
      }).then(([row]) => row) as any;
    }
  }
  return Model as ModelConstructor<typeof Model, Definition>;
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

function query<T>(options: QueryObjectOptions) {
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
