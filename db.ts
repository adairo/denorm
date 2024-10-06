import { Client } from "https://deno.land/x/postgres/mod.ts";

const client = new Client();
await client.connect()
export default client;
