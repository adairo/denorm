import type { QueryObjectOptions } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import client from "./db.ts";

/* export default abstract class ActiveRecord {
  private static columnMap: ModelMap;
  private static tableName: string;

   constructor(public dataValues: Record<string, string>) {
  }

  private static query(options: QueryObjectOptions) {
    return client.queryObject(options).then((result) => result.rows);
  }

  static create<TModel>(
    this: (new () => TModel) & typeof ActiveRecord,
    values: Record<string, string | number>,
  ): Promise<TModel> {
    const entries = Object.entries(values);
    const columnNames = entries.map((entry) => entry.at(0));
    const columnValues = entries.map((entry) => entry.at(1));
    const columnParameterList = columnValues.map((_k, index) =>
      `$${index + 1}`
    );

    return this.query({
      text: `
        INSERT INTO ${this.tableName}
          (${columnNames.join(",")})
          VALUES (${columnParameterList.join(",")})
        RETURNING *
      `,
      args: columnValues,
    }).then(([row]) => {
      return new this();
    });
  }

  static build<Model>(
    this: new (values: any) => Model,
    values: Record<string, any>,
  ) {
    const instance = new this(values);

    return instance;
  }

  static find(id: number | string) {
    return this.query({
      text: `
        SELECT *
        FROM ${this.tableName}
        WHERE ${this.tableName}.id = $1`,
      args: [id],
    });
  }

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

function createModel<Shape>(modelName: string) {
  abstract class Model implements Model {
    static readonly modelName: string = modelName;

    constructor(public modelName: string, public modelDefinition: Shape) {}
    static build(values: Partial<Shape>) {
      return this;
    }
  }

  return Model;
}

type Model<TDefinition extends ModelDefinition = { columns: {} }> = {
  new (): {};
  readonly modelName: string;
  build(values: Partial<TDefinition["columns"]>): string;
};

type ModelMap = Record<string, Model>;

type ModelDefinition = {
  columns: Record<string, string | { type: "string" | "number" }>;
};

class ORM<TMap extends ModelMap = {}> {
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
    ) as any;
    return this as any;
  }
}

const orm = new ORM();

export const builded = orm.defineModel(
  "User",
  {
    columns: {
      first_name: "string",
    },
  },
);

class User extends builded.models.User {
}

builded.models.User.build({ first_name: "string" });
