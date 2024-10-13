import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const client = new Client();
await client.connect();
export default client;
