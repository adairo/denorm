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

const UserModel = createModel("User", {
  tableName: "users",
  columns: {
    first_name: { type: "string", notNull: true },
    last_name: "string",
  },
});

class User extends UserModel {
  get full_name(): string {
    return `${this.first_name} ${this.last_name}`;
  }
}

const user = await User.build({
  first_name: "Adairo",
  last_name: "Reyes Reyes",
}).save();

await User.update(user.id, { first_name: "Static update" });
const refetchedUser = await User.find(user.id)
console.log(refetchedUser)

type ModelConstructor<Model, Definition> =
  & Model
  & Constructor<
    TranslateDefinition<Definition>
  >;

type InitializedModel<Model, Definition> = TranslateDefinition<Definition>;

type Constructor<T> = new (...args: any[]) => T;

function createModel<Definition extends ModelDefinition>(
  modelName: string,
  modelDefinition: Definition,
) {
  abstract class Model {
    static modelName: string = modelName;
    static tableName: string = modelDefinition.tableName;
    static modelDefinition: Definition = modelDefinition;
    private dataValues: TranslateDefinition<Definition>;
    #id: number | null;

    get id() {
      return this.#id;
    }

    private constructor(dataValues: TranslateDefinition<Definition>) {
      this.dataValues = dataValues;

      Object.keys(Model.modelDefinition.columns).forEach((columnKey) =>
        Object.defineProperty(this, columnKey, {
          get() {
            return this.dataValues[columnKey];
          },
        })
      );
    }

    static build<Model>(
      this: Constructor<Model>,
      values: TranslateDefinition<Definition>,
    ): Model {
      return new this(values);
    }

    static create<Model>(
      values: TranslateDefinition<Definition>,
    ) {
      return this.build(values).save();
    }

    static find<Model>(
      this: Constructor<Model>,
      id: number,
    ): Promise<Model & { id: number } | null> {
      return query({
        text: `
          SELECT *
          FROM ${this.tableName}
          WHERE ${this.tableName}.id = $1`,
        args: [id],
      }).then(([row]) => row ? this.build(row) : null);
    }

    save<Model>(this: Model): Promise<Model & { id: number }> {
      const entries = Object.entries(this.dataValues);
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
      }).then(([row]) => this.#id = row.id).then(() => this);
    }

    static update(
      id: number | string,
      data: Partial<TranslateDefinition<Definition>>,
    ) {
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
          `,
        args,
      });
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

type ModelMap = Record<string, InitializedModel>;

type ModelDefinition = {
  tableName: string;
  columns: Record<
    string,
    ColumnType | { type: ColumnType; notNull?: boolean }
  >;
};

function query(options: QueryObjectOptions) {
  return client.queryObject(options).then((result) => result.rows);
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
