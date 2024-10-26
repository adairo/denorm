// deno-lint-ignore-file no-explicit-any

import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import {
  type DeleteQuery,
  deleteQuery,
  insertInto,
  type InsertQuery,
  select,
  type SelectQuery,
  update,
  type UpdateQuery,
} from "./queries.ts";
import type { ClientConfiguration } from "https://deno.land/x/postgres@v0.19.3/connection/connection_params.ts";

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
};

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

export default class Orm {
  #client: Client;
  constructor(config?: ClientConfiguration) {
    this.#client = new Client(config);
  }

  get client() {
    return this.#client;
  }

  public defineModel<
    Definition extends ModelDefinition,
    Schema extends Record<string, any> = ModelSchema<Definition>,
    PrimaryKey extends Record<any, any> = GetPrimaryKey<Definition["columns"]>,
    Pk = ValuesOf<PrimaryKey>,
  >(
    modelName: string,
    modelDefinition: Definition,
  ) {
    const client = this.#client;
    class Model {
      static modelName: string = modelName;
      static tableName: string = modelDefinition.tableName;
      static modelDefinition: Definition = modelDefinition;
      #dataValues: Schema;
      #persisted: boolean = false;

      /** Getters and setters */
      // deno-lint-ignore ban-types
      getDataValue<K extends keyof Schema | (string & {})>(
        key: K,
      ): K extends keyof Schema ? Schema[K] : unknown {
        return this.#dataValues[key] as any;
      }

      setDataValue<K extends keyof Schema>(key: K, value: Schema[K]): this {
        this.#dataValues[key] = value;
        return this;
      }

      get primaryKey(): Pk | null {
        return this.dataValues[Model.primaryKeyColumn];
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
        Object.entries(dataValues).forEach(([key, value]) =>
          this.setDataValue(key, value)
        );
        return this;
      }

      /** Static members */

      static primaryKeyColumn: string;

      static {
        const pkColumn = getPrimaryKeyColumn(this.modelDefinition.columns);
        if (!pkColumn) {
          throw new Error(
            "It is mandatory for a model to define a primary key",
          );
        }
        this.primaryKeyColumn = pkColumn;
      }

      constructor() {
        const modelColumns = Model.columns();
        this.#dataValues = modelColumns.reduce((object, column) => {
          Object.defineProperty(object, column, {
            value: null,
            writable: true,
            enumerable: true,
          });
          return object;
        }, Object.create(null));

        modelColumns.forEach((column) =>
          Object.defineProperty(this, column, {
            get(this: Model) {
              return this.getDataValue(column);
            },
            set(this: Model, value: any) {
              this.setDataValue(column, value);
            },
            enumerable: true,
          })
        );
      }

      static columns() {
        return Object.keys(this.modelDefinition.columns);
      }

      static async select<ConcreteModel extends typeof Model>(
        this: ConcreteModel,
        columnsOrValues: Array<keyof Schema> | string[],
        queryOptions: Omit<SelectQuery<Schema>, "from">,
      ): Promise<Array<InstanceType<ConcreteModel>>> {
        const result = await select<Schema>(columnsOrValues, {
          ...queryOptions,
          from: this.tableName,
        }, client);
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
        const result = await this.select(columnsOrValues, {
          where: {
            [Model.primaryKeyColumn]: primaryKey,
          } as unknown as Schema,
          limit: 1,
        });
        const modelInstance = result[0];
        if (!modelInstance) {
          throw new Error(
            `${this.modelName} with ${Model.primaryKeyColumn}=${primaryKey} does not exist`,
          );
        }
        return modelInstance;
      }

      static update(
        query: UpdateQuery<Partial<Schema>>,
      ): Promise<any> {
        return update(this.tableName, query, client);
      }

      static async delete<Returning extends Record<PropertyKey, any>>(
        query: Omit<DeleteQuery, "from">,
      ): Promise<Returning[]> {
        const result = await deleteQuery<Returning>(
          { ...query, from: this.tableName },
          client!,
        );

        return result;
      }

      static create<ConcreteModel extends typeof Model>(
        this: ConcreteModel,
        values:
          & Omit<Schema, keyof PrimaryKey>
          & Partial<PrimaryKey>,
      ): Promise<InstanceType<ConcreteModel>> {
        return this.build(values).save() as any;
      }

      /** Public instance methods */

      async save(): Promise<this> {
        if (this.persisted) {
          return this.update(this.dataValues);
        }

        const allowedKeys = new Set(Model.columns()).intersection(
          new Set(Object.keys(this.dataValues)),
        );

        const payload = allowedKeys.keys().reduce<Record<string, any>>(
          (object, column) => {
            if (column === Model.primaryKeyColumn) {
              return object;
            }
            
            const value = this.getDataValue(column);
            object[column] = value;
            return object;
          },
          Object.create(null),
        );

        const [result] = await insertInto<PrimaryKey>(Model.tableName, {
          values: payload,
          returning: Model.primaryKeyColumn,
        }, client);

        this.set(result); // set primaryKey
        this.#persisted = true;

        return this;
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
        this.set(data);
        await Model.update({
          set: data,
          where: { [Model.primaryKeyColumn]: this.primaryKey },
        });
        return this;
      }

      async delete(): Promise<this> {
        assertPersisted(this, Model);
        await Model.delete({
          where: { [Model.primaryKeyColumn]: this.primaryKey },
        });
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
