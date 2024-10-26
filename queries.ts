// deno-lint-ignore-file no-explicit-any
import type { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

type WhereClause = Record<PropertyKey, any>;

function getReturningClause(returning: string[] | string | undefined): string {
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
    )
        .join(` ${separator} `);
}

function entries(obj: Record<PropertyKey, any>) {
    const entries = Object.entries(obj);
    const keys = entries.map((entry) => entry[0]);
    const values = entries.map((entry) => entry[1]);
    const length = entries.length;

    return { keys, values, length };
}

export function select<
    Columns extends Record<string, any>,
>(
    columnsOrValues: Array<keyof Columns>,
    query: SelectQuery,
    client: Client,
) {
    const { keys: whereColumns, values: whereArgs } = entries(
        query?.where ?? {},
    );

    const whereClause = createWhereClause(whereColumns, 1, "AND", "=");

    return client.queryObject<Partial<Columns>>({
        text: `
      SELECT
        ${columnsOrValues.join(",")}
      FROM
        ${query.from}
        ${
            query.where
                ? `WHERE
        ${whereClause}`
                : ""
        }
    ${
            query.orderBy
                ? ` ORDER BY ${
                    query.orderBy.map(([col, order]) =>
                        `${String(col)} ${order}`
                    ).join(", ")
                }`
                : ""
        }
      
     ${query.limit ? `LIMIT ${query.limit}` : ""}
    `,
        args: whereArgs.concat(),
    });
}

export type UpdateQuery<Model extends Record<string, any>> = {
    set: Partial<Model>;
    where: Record<string, any>;
    returning?: Array<keyof Model> | string;
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

    const rows = await client.queryObject({
        text: `
          UPDATE ${tableName}
          SET ${updatedFields}
          WHERE ${whereConditions}
          ${
            query.returning
                ? `RETURNING ${
                    Array.isArray(query.returning)
                        ? query.returning.join(",")
                        : query.returning
                }`
                : ""
        }
          `,
        args,
    }).then((result) => result.rows);

    return rows as any;
}

export type InsertQuery = {
    values: Record<string, any>;
    columns?: string[];
    returning?: Array<string> | string;
};

export async function insertInto<
    Returning extends Record<string, any>,
>(
    tableName: string,
    query: InsertQuery,
    client: Client,
): Promise<Returning[]> {
    const { keys, values: valuesToInsert } = entries(query.values);

    const columnParameterList = valuesToInsert.map((_k, index) =>
        `$${index + 1}`
    );
    const rows = await client.queryObject<Returning>({
        text: `
          INSERT INTO ${tableName}
            ${keys.length > 0 ? `(${keys.join(",")})` : ""} 
            ${
            keys.length > 0 ? `VALUES (${columnParameterList.join(",")})` : ""
        }
            ${
            query.returning
                ? `RETURNING ${
                    Array.isArray(query.returning)
                        ? query.returning.join(",")
                        : query.returning
                }`
                : ""
        }
        `,
        args: valuesToInsert,
    }).then((result) => result.rows);
    return rows;
}

export type DeleteQuery = {
    where: WhereClause;
    returning?: Array<string> | string;
    from: string;
};

export async function deleteQuery<Returning extends Record<PropertyKey, any>>(
    query: DeleteQuery,
    client: Client,
): Promise<Returning[]> {
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
    const rows = await client.queryObject<Returning>({
        text: `
          DELETE FROM ${query.from}
          WHERE ${whereConditions}
          ${getReturningClause(query.returning)} 
          `,
        args: whereEntries.values,
    }).then((result) => result.rows);

    return rows;
}
