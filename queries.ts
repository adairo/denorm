// deno-lint-ignore-file no-explicit-any ban-types
import type {
  Client,
  QueryObjectResult,
} from "https://deno.land/x/postgres@v0.19.3/mod.ts";

type WhereClause = Record<PropertyKey, any>;
type Returning<Columns extends Record<string, any> = any> =
  | Array<keyof Columns | (string & {})>
  | string;

function getReturningClause(returning?: Returning<any>): string {
  if (!returning) {
    return "";
  }
  const selected = Array.isArray(returning) ? returning : [returning];
  return "RETURNING " + selected.join(",");
}

export type SelectQuery<Columns extends WhereClause = WhereClause> = {
  where?: Partial<Columns>;
  from: string;
  orderBy?: Array<
    [
      keyof Columns,
      "ASC" | "DESC",
    ]
  >;
  limit?: number;
  offset?: number;
};

function createWhereClause(
  conditions: string[],
  startIndex: number,
  separator: string,
  operator: string,
) {
  return conditions.map((col, index) =>
    `${col} ${operator} $${index + startIndex}`
  ).join(` ${separator} `);
}

function entries(obj: Record<PropertyKey, any>) {
  const entries = Object.entries(obj);
  const length = entries.length;
  const { keys, values } = entries.reduce(
    (acc, [key, value], index) => {
      acc.keys[index] = key;
      acc.values[index] = value;
      return acc;
    },
    { keys: new Array(length), values: new Array(length) },
  );

  return { keys, values, length };
}

export function select<Columns extends Record<string, any>>(
  client: Client,
  columnsOrValues: Array<keyof Columns>,
  query: SelectQuery,
) {
  const { keys: whereColumns, values: whereArgs } = entries(
    query?.where ?? {},
  );

  const whereClause = createWhereClause(whereColumns, 1, "AND", "=");
  const orderBy = query?.orderBy?.map(([col, order]) =>
    `${String(col)} ${order}`
  ).join(", ");

  return client.queryObject<Partial<Columns>>({
    args: whereArgs,
    text: `
      SELECT
        ${columnsOrValues.join(",")}
      FROM
        ${query.from}
    ${query.where ? `WHERE ${whereClause}` : ""}
    ${query.orderBy ? ` ORDER BY ${orderBy}` : ""}
    ${query.limit ? `LIMIT ${query.limit}` : ""}
    `,
  });
}

export type UpdateQuery<Columns extends Record<string, any>> = {
  set: Partial<Columns>;
  where: Record<string, any>;
  returning?: Returning<Columns>;
};

export async function update<
  Schema extends Record<string, any>,
>(
  tableName: string,
  query: UpdateQuery<Schema>,
  client: Client,
): Promise<Schema[]> {
  const whereEntries = entries(query.where);
  const whereConditions = createWhereClause(
    whereEntries.keys.map((condition) => `${tableName}.${condition}`),
    1,
    "AND",
    "=",
  );

  const updateEntries = entries(query.set);
  const updatedFields = createWhereClause(
    updateEntries.keys,
    whereEntries.length + 1,
    ",",
    "=",
  );

  const args = whereEntries.values.concat(
    updateEntries.values,
  );

  const result = await client.queryObject({
    text: `
          UPDATE ${tableName}
          SET ${updatedFields}
          WHERE ${whereConditions}
          ${getReturningClause(query.returning)}
          `,
    args,
  });

  return result.rows as any;
}

export type InsertQuery = {
  values: Record<string, any>;
  columns?: string[];
  returning?: Array<string> | string;
};

export function insertInto<T>(
  client: Client,
  tableName: string,
  query: InsertQuery,
): Promise<QueryObjectResult<T>> {
  const { keys, values: valuesToInsert } = entries(query.values);

  const columnParameterList = valuesToInsert.map((_k, index) =>
    `$${index + 1}`
  );

  return client.queryObject<T>({
    args: valuesToInsert,
    text: `
      INSERT INTO ${tableName}
        ${keys.length > 0 ? `(${keys.join(",")})` : ""} 
        ${keys.length > 0 ? `VALUES (${columnParameterList.join(",")})` : ""}
        ${getReturningClause(query.returning)}
        `,
  });
}

export type DeleteQuery = {
  where: WhereClause;
  returning?: Returning;
  from: string;
};

export async function deleteQuery<R>(
  client: Client,
  query: DeleteQuery,
): Promise<R[]> {
  if (!query.where) {
    throw new Error("Where clause is mandatory");
  }

  const whereEntries = entries(query.where);
  const whereConditions = createWhereClause(
    whereEntries.keys.map((column) => `${query.from}.${column}`),
    1,
    "AND",
    "=",
  );
  const result = await client.queryObject<R>({
    text: `
          DELETE FROM ${query.from}
          WHERE ${whereConditions}
          ${getReturningClause(query.returning)} 
          `,
    args: whereEntries.values,
  });

  return result.rows;
}
