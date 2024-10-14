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
type WithId = { id: number };
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

const user = await new User({
  first_name: "Adairo",
  last_name: "Reyes Reyes",
}).save();

const { id } = await user.update({
  first_name: "instance update",
});

console.log(await User.find(id));

type ModelConstructor<Model, Definition extends ModelDefinition> =
  & Model
  & Constructor<
    TranslateDefinition<Definition>
  >;

type InitializedModel<Model, Definition extends ModelDefinition> =
  TranslateDefinition<Definition>;

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
    #id: number | null = null;

    get id() {
      return this.#id;
    }

    constructor(dataValues: TranslateDefinition<Definition>) {
      this.dataValues = dataValues;

      Object.keys(Model.modelDefinition.columns).forEach((columnKey) =>
        Object.defineProperty(this, columnKey, {
          get() {
            return this.dataValues[columnKey];
          },
        })
      );
    }

    static create<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      values: TranslateDefinition<Definition>,
    ) {
      return new this(values).save();
    }

    static async find<ConcreteModel extends Model>(
      this: Constructor<ConcreteModel>,
      id: number,
    ): Promise<ConcreteModel | null> {
      const [row] = await query({
        text: `
          SELECT *
          FROM ${Model.tableName}
          WHERE ${Model.tableName}.id = $1`,
        args: [id],
      });
      return row ? new this(row) : null;
    }

    // Make return as Model & {id: number}
    save() {
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
      }).then(([row]) => this.#id = (row as any).id).then(() => this);
    }

    update(data: Partial<TranslateDefinition<Definition>>): Promise<WithId> {
      if (this.id === null) {
        throw new Error(
          "This model instance is not initialized, did you forget to call Model.save() first?",
        );
      }
      return Model.update(this.id, data);
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
