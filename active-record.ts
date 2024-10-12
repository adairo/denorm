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

const AbstractUser = createModel("User", {
  columns: {
    firstName: { type: "string", allowNull: true },
    lastName: "string",
    birthDate: "date",
    age: "number",
  },
});

class User extends AbstractUser {
  get fullCredentials(): string {
    return `${this.firstName} ${this.lastName}, ${
      this.birthDate ? this.birthDate.toLocaleDateString() : "unknown birthdate"
    }`;
  }
}

const user = User.build({
  firstName: "Adair",
  lastName: "Reyes",
  birthDate: new Date(),
});
console.log(user.fullCredentials);

// deno-lint-ignore no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

function createModel<Definition extends ModelDefinition>(
  modelName: string,
  modelDefinition: Definition,
) {
  abstract class AbstractModel {
    static modelName: string = modelName;
    static modelDefinition: Definition = modelDefinition;

    private constructor(private dataValues: TranslateDefinition<Definition>) {
      Object.keys(AbstractModel.modelDefinition.columns).forEach((columnKey) =>
        Object.defineProperty(this, columnKey, {
          get() {
            return dataValues[columnKey];
          },
        })
      );
    }

    static build<T>(
      // deno-lint-ignore no-explicit-any
      this: new (...args: any[]) => T,
      values: Partial<TranslateDefinition<Definition>>,
    ): T & TranslateDefinition<Definition> {
      return new this(values) as any;
    }

    save() {}
  }

  return AbstractModel as unknown as
    & typeof AbstractModel
    & Constructor<
      TranslateDefinition<Definition>
    >;
}

interface Model<Definition extends ModelDefinition = { columns: {} }> {
  new (dataValues: Partial<Definition["columns"]>): {};
  readonly modelName: string;
  build(
    values: Partial<TranslateDefinition<Definition>>,
  ): ReturnType<typeof createModel>;
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

type ModelMap = Record<string, Model>;

type ModelDefinition = {
  columns: Record<
    string,
    ColumnType | { type: ColumnType; allowNull?: boolean }
  >;
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
      modelDefinition,
    ) as any;
    return this as any;
  }
}
