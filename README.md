# Denorm
A simple type-safe orm built for deno. Here you can [read the full tutorial](https://medium.com/@adairo.dev/construye-tu-propio-orm-con-typescript-y-postgres-sql-9c679076ab50).

## Instructions
1. [Install deno](https://docs.deno.com/runtime/#install-deno)
2. Clone this repo
    ```
    git clone https://github.com/adairo/denorm.git & cd denorm
    ```
3. Create a postgres database
4. Create a `.env` file from `.env.example`
5. Populate the `.env` file with your database credentials
6. Run `deno test --env -A` for running the tests

## Usage

```ts
import Orm from "./model.ts";

const orm = new Orm();
await orm.client.connect();

console.log("Connected to database");

await orm.client.queryObject(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        birthday DATE
    );

    CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id)
    );
`);

console.log("Tables created");

export class User extends orm.defineModel({
  tableName: "users",
  modelName: "User",
  columns: {
    id: { type: "integer", primaryKey: true },
    name: "text",
    email: "text",
    birthdate: "date",
  },
}) {
  createPost(title: string, content: string): Promise<Post> {
    return Post.create({
      title,
      content,
      user_id: this.id,
    });
  }

  get posts(): Promise<Post[]> {
    return Post.select(["*"], {
      where: {
        user_id: this.id,
      },
    });
  }

  get age(): number {
    return new Date().getFullYear() - this.birthdate.getFullYear();
  }
}

export class Post extends orm.defineModel({
  tableName: "posts",
  modelName: "Post",
  columns: {
    id: { type: "integer", primaryKey: true },
    title: "text",
    content: "text",
    user_id: {
      type: "integer",
      notNull: true,
    },
  },
}) {
  get author(): Promise<User> {
    return User.find(this.user_id, ["id", "name", "email"]);
  }

  async sendEmailToAuthor(message: string) {
    console.log(`Email sent to ${(await this.author).email}: \n\t${message}`);
  }
}

const user = await User.create({
  name: "Adair",
  email: "ad@iro.com",
  birthday: new Date("1800-01-01"),
});

console.log("Created user with id:", user.id);
console.log("Adair is", user.age, "years old 🦖");
console.log("Adair has", (await (user.posts)).length, "posts");
console.log("Creating posts...");

await user.createPost("Create your own Orm", "class Model {}");
await user.createPost("Create your own Axios", "class Fetch {}");

console.log("Now Adair has", (await (user.posts)).length, "posts");
console.log((await (user.posts)).map((post) => post.dataValues));

await posts.at(1)?.delete();

console.log("\nDeleted first post");
console.log("Adair's posts:", (await user.posts).map((post) => post.title));

const onlyPost = (await user.posts).at(0);
const postAuthor = await onlyPost?.author;

console.log(
  "The author of bestseller",
  `"${onlyPost?.title}"`,
  "is",
  postAuthor?.name,
);
console.log("Sending email to author...");

await onlyPost?.sendEmailToAuthor("Hello, really hated your last post! :D");
await orm.client.end();

console.log("Connection to database closed");
```