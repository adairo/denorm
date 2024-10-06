import client from "./db.ts";

export default abstract class ActiveRecord {
  private static tableName: string;

  static create(values: Record<string, string | number>) {
    const entries = Object.entries(values);
    const columnNames = entries.map((entry) => entry.at(0));
    const columnValues = entries.map((entry) => entry.at(1));
    const columnParameterList = columnValues.map((_k, index) =>
      `$${index + 1}`
    );

    return client.queryObject({
      text: `INSERT INTO ${this.tableName} (${columnNames.join(",")}) VALUES (${
        columnParameterList.join(",")
      })`,
      args: columnValues,
    });
  }

  static init(tableName: string) {
    this.tableName = tableName;
  }
}

