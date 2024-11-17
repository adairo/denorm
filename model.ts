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

function assertPersisted(
  instance: any,
  model: Model,
): void {
  if (instance.primaryKey === null || !instance.persisted) {
    throw new Error(
      `This ${model.modelName} model instance is not persisted yet, did you call ${model.modelName}.save() first?`,
    );
  }
}

function getPrimaryKeyColumn(columns: ModelColumns): string {
  const primaryKeys = Object.keys(columns).filter(
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

  if (primaryKeys.length !== 1) {
    throw new Error("A model must define one and only one primary key");
  }

  return primaryKeys[0];
}

type Model = {
  modelName: string;
  modelDefinition: ModelDefinition;
};

export type ModelDefinition = {
  tableName: string;
  columns: ModelColumns;
};

type ModelColumns = Record<
  string,
  DataType | ColumnDefinition
>;

type ColumnDefinition = {
  type: DataType;
  notNull?: boolean;
  primaryKey?: boolean;
};

type DataTypeMap = {
  "text": string;
  "uuid": string;
  "integer": number;
  "boolean": boolean;
  [dataType: `date${string | undefined}`]: Date;
  [dataType: `timestamp${string | undefined}`]: Date;
};

type DataType = keyof DataTypeMap;

type ModelSchema<
  Definition extends ModelDefinition,
  Columns = Definition["columns"],
> = {
  [Col in keyof Columns]: Columns[Col] extends DataType
    ? DataTypeMap[Columns[Col]]
    : Columns[Col] extends ColumnDefinition ? DataTypeMap[Columns[Col]["type"]]
    : never;
};

type Constructor<T, K extends any[] = any[]> = new (
  ...any: K
) => T;

type GetPrimaryKey<Columns extends ModelDefinition["columns"]> = {
  [
    Key in keyof Columns as Columns[Key] extends ColumnDefinition
      ? Columns[Key]["primaryKey"] extends true ? Key : never
      : never
  ]: Columns[Key] extends ColumnDefinition ? DataTypeMap[Columns[Key]["type"]]
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
    class _Model {
      static modelName: string = modelName;
      static modelDefinition: Definition = modelDefinition;
      static primaryKeyColumn: string = getPrimaryKeyColumn(
        this.modelDefinition.columns,
      );
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
        return this.dataValues[_Model.primaryKeyColumn];
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

      /** Static methods */

      constructor() {
        const modelColumns = _Model.columns();
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
            get(this: _Model) {
              return this.getDataValue(column);
            },
            set(this: _Model, value: any) {
              this.setDataValue(column, value);
            },
            enumerable: true,
          })
        );
      }

      static columns(): string[] {
        return Object.keys(this.modelDefinition.columns);
      }

      static async select<ConcreteModel extends typeof _Model>(
        this: ConcreteModel,
        columnsOrValues: Array<keyof Schema> | string[],
        queryOptions: Omit<SelectQuery<Schema>, "from">,
      ): Promise<Array<InstanceType<ConcreteModel>>> {
        const result = await select<Schema>(columnsOrValues, {
          ...queryOptions,
          from: this.modelDefinition.tableName,
        }, client);
        return result.rows.map((row) => {
          const instance = new this().set(row);
          instance.persisted = true;
          return instance as InstanceType<ConcreteModel>;
        });
      }

      static build<ConcreteModel extends typeof _Model>(
        this: ConcreteModel,
        values: Partial<Schema> = {},
      ): InstanceType<ConcreteModel> {
        return new this().set(
          values,
        ) as any;
      }

      static async findByPk<ConcreteModel extends typeof _Model>(
        this: ConcreteModel,
        primaryKey: Pk,
        columnsOrValues: Array<keyof Schema> = Object.keys(
          this.modelDefinition.columns,
        ),
      ): Promise<InstanceType<ConcreteModel>> {
        if (primaryKey === null || typeof primaryKey === "undefined") {
          throw new Error(`${primaryKey} is not a valid identifier`);
        }
        const [modelInstance] = await this.select(columnsOrValues, {
          where: {
            [_Model.primaryKeyColumn]: primaryKey,
          } as unknown as Schema,
          limit: 1,
        });

        if (!modelInstance) {
          throw new Error(
            `${this.modelName} with ${_Model.primaryKeyColumn}=${primaryKey} does not exist`,
          );
        }
        return modelInstance;
      }

      static update(
        query: UpdateQuery<Partial<Schema>>,
      ): Promise<any> {
        return update(this.modelDefinition.tableName, query, client);
      }

      static async delete<Returning extends Record<PropertyKey, any>>(
        query: Omit<DeleteQuery, "from">,
      ): Promise<Returning[]> {
        const result = await deleteQuery<Returning>(
          { ...query, from: this.modelDefinition.tableName },
          client!,
        );

        return result;
      }

      static create<ConcreteModel extends typeof _Model>(
        this: ConcreteModel,
        values:
          & Omit<Partial<Schema>, keyof PrimaryKey>
          & Partial<PrimaryKey>,
      ): Promise<InstanceType<ConcreteModel>> {
        return this.build(values).save() as any;
      }

      /** Public instance methods */

      async save(): Promise<this> {
        if (this.persisted) {
          return this.update(this.dataValues);
        }

        const allowedKeys = new Set(_Model.columns()).intersection(
          new Set(Object.keys(this.dataValues)),
        );

        const payload = allowedKeys.keys().reduce<Record<string, any>>(
          (object, column) => {
            if (column === _Model.primaryKeyColumn) {
              return object;
            }

            object[column] = this.getDataValue(column);
            return object;
          },
          Object.create(null),
        );

        const [result] = await insertInto<PrimaryKey>(
          _Model.modelDefinition.tableName,
          {
            values: payload,
            returning: _Model.primaryKeyColumn,
          },
          client,
        );

        this.set(result); // set primaryKey
        this.#persisted = true;

        return this;
      }

      async reload(): Promise<this> {
        assertPersisted(this, _Model);
        const clone = await _Model.findByPk(this.primaryKey!);
        this.set(clone.dataValues);
        return this;
      }

      async update(
        data: Partial<Schema>,
      ): Promise<this> {
        assertPersisted(this, _Model);
        this.set(data);
        await _Model.update({
          set: data,
          where: { [_Model.primaryKeyColumn]: this.primaryKey },
        });
        return this;
      }

      async delete(): Promise<this> {
        assertPersisted(this, _Model);
        await _Model.delete({
          where: { [_Model.primaryKeyColumn]: this.primaryKey },
        });
        this.#persisted = false;
        this.set({ id: null } as any);
        return this as any;
      }

      toJSON() {
        return JSON.stringify(this.#dataValues);
      }
    }
    return _Model as
      & typeof _Model
      & Model
      & Constructor<Schema>;
  }
}
