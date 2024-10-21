// deno-lint-ignore-file no-explicit-any
import type { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

export type SelectQuery<Model extends Record<string, any>> = {
    where?: Partial<
        Record<keyof Model, any>
    >;
    from: string;
    orderBy?: Array<
        [
            keyof Model,
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
    query: SelectQuery<Columns>,
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
