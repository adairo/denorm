import type { QueryObjectOptions } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import client from "./db.ts";

export default abstract class ActiveRecord {
  private static tableName: string;

  private static query(options: QueryObjectOptions) {
    return client.queryObject(options).then((result) => result.rows);
  }

  static create(values: Record<string, string | number>) {
    const entries = Object.entries(values);
    const columnNames = entries.map((entry) => entry.at(0));
    const columnValues = entries.map((entry) => entry.at(1));
    const columnParameterList = columnValues.map((_k, index) =>
      `$${index + 1}`
    );

    return this.query({
      text: `INSERT INTO ${this.tableName} (${columnNames.join(",")}) VALUES (${
        columnParameterList.join(",")
      })`,
      args: columnValues,
    });
  }

  static find(id: number | string) {
    return this.query({
      text: `SELECT * FROM ${this.tableName} WHERE ${this.tableName}.id = $id`,
      args: { id }
    });
  }

  static init(tableName: string) {
    this.tableName = tableName;
  }
}
