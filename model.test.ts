// deno-lint-ignore-file no-explicit-any
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "jsr:@std/testing/bdd";
import {
  assertSpyCall,
  assertSpyCalls,
  spy,
  stub,
} from "jsr:@std/testing/mock";
import { defineModel } from "./model.ts";
import { expect } from "jsr:@std/expect";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

describe({
  name: "defineModel function",
}, () => {
  const modelDefinition = {
    tableName: "models",
    columns: {},
  };

  it("stores the Model definition", () => {
    const Model = defineModel("Model", modelDefinition);
    expect(Model.modelDefinition).toEqual(modelDefinition);
  });

  it("returns a class that can be instantiated", () => {
    const Model = defineModel("Model", modelDefinition);
    const instance = new Model();
    expect(instance).toBeInstanceOf(Model);
  });
});

describe("Extended Model class", () => {
  class Extended extends defineModel("Original", {
    columns: { id: "text" },
    tableName: "_",
  }) {}

  describe("build", () => {
    it("returns an instance of the Extended class", () => {
      expect(Extended.build({})).toBeInstanceOf(Extended);
    });
  });
});

describe("Unextended Model class", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client();

    await db.connect();
    await db.queryObject(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name TEXT,
        last_name TEXT
      )`);
  });

  beforeEach(async () => {
    await db.queryObject(`
      TRUNCATE users
    `);
  });

  afterAll(async () => {
    await db.queryObject(`
      DROP TABLE users
    `);
    await db.end();
  });

  const modelDefinition = {
    tableName: "users",
    columns: {
      id: { type: "integer", primaryKey: true },
      first_name: "text",
      last_name: "text",
    },
  } as const;

  let User = defineModel("User", modelDefinition);

  beforeEach(() => {
    User = defineModel("User", modelDefinition, db);
  });

  describe("static methods", () => {
    describe("static build()", () => {
      it("stores the dataValues", () => {
        const userData = { first_name: "Foo", last_name: "Bar", id: 1 };
        const user = User.build(userData);
        expect(user.dataValues).toEqual(userData);
      });

      it("creates property accesors for dataValues", () => {
        const userData = { first_name: "Foo", last_name: "Bar", id: 1 };
        const user = User.build(userData);
        expect(user).toEqual(userData);
      });

      it("saves the primaryKey", () => {
        const ModelWithPk = defineModel("_", {
          tableName: "_",
          columns: {
            id: "integer",
            uuid: { type: "uuid", primaryKey: true },
          },
        });
        const user = ModelWithPk.build({ id: 1, uuid: "abc" });
        expect(user.primaryKey).toBe("abc");
        expect(user.primaryKeyProperty).toBe("uuid");
      });

      it("creates a non persisted instance", () => {
        const user = User.build({ first_name: "Foo" });
        expect(user.persisted).toBe(false);
      });
    });

    describe("static create()", () => {
      it("directly creates a persisted instance", async () => {
        const user = await User.create({
          first_name: "Foo",
          last_name: "Bar",
        });
        expect(user.persisted).toBeTruthy();
        expect(user.primaryKey).toBeDefined();
      });
    });

    describe("static find()", () => {
      let user = new User();
      const userData = { first_name: "Find", last_name: "Method" };

      beforeEach(async () => {
        user = await User.create(userData);
      });

      it("Returns a persisted instance of the model", async () => {
        user = await User.find(user.id);
        expect(user).toBeInstanceOf(User);
        expect(user.persisted).toBeTruthy();
      });

      it("Has the provided dataValues", async () => {
        user = await User.find(user.id);
        expect(user.first_name).toEqual(userData.first_name);
        expect(user.last_name).toEqual(userData.last_name);
      });

      it("Fetches only passed columns if specified", async () => {
        user = await User.find(user.id, ["last_name"]);
        expect(user.id).toBeNull();
        expect(user.first_name).toBeNull();
        expect(user.last_name).toBe(userData.last_name);
      });

      it("Throws if passed nullish param", () => {
        expect(User.find(null as any)).rejects.toThrow(
          "is not a valid identifier",
        );
        expect(User.find(undefined as any)).rejects.toThrow();
      });

      it("Throws if it doesnt find a row with that Pk", () => {
        expect(User.find(-1)).rejects.toThrow("User with id=-1 does not exist");
      });

      it("Throws if the model does not define a PK", () => {
        const ModelWithoutPk = defineModel("_", {
          columns: { foo: "integer" },
          tableName: "_",
        });
        expect(ModelWithoutPk.find(1 /** valid pk */)).rejects.toThrow(
          "model doesn't have a known primary key",
        );
      });
    });

    describe("static update()", () => {
      let user = new User();
      const initialValues = {
        first_name: "John",
        last_name: "Values",
      };

      beforeEach(async () => {
        user = await User.create(initialValues);
      });

      it("Updates values on db", async () => {
        await User.update(user.id, { first_name: "Updated" });
        const retrieved = await User.find(user.id);
        expect(retrieved.first_name).toBe("Updated");
      });

      it("Returns the id of the updated row", async () => {
        const result = await User.update(user.id, { first_name: "Updated" });
        expect(result).toBe(user.id);
      });
    });

    describe("static columns()", () => {
      it("returns an array of all model columns", () => {
        expect(new Set(User.columns())).toStrictEqual(
          new Set(["first_name", "last_name", "id"]),
        );
      });
    });
  });

  describe("instance methods", () => {
    const userData = { first_name: "Foo", last_name: "Bar" };
    let userInstance = User.build({});

    beforeEach(() => {
      userInstance = User.build(userData);
    });

    describe("set()", () => {
      it("stores multiple values passed", () => {
        const updatedData = { first_name: "Changed", id: 10 };
        userInstance.set(updatedData);
        const { first_name, id } = userInstance;
        expect({ first_name, id }).toEqual(updatedData);
      });

      it("ignores columns not present on model definition", () => {
        userInstance.set({ first_name: "Defined", age: 2 } as any);
        expect((userInstance as any).age).toBeUndefined();
        expect((userInstance.dataValues as any).age).toBeUndefined();
      });
    });

    describe("save()", () => {
      it("the primaryKey is saved", async () => {
        expect(userInstance.primaryKey).toBeNull();
        await userInstance.save();
        expect(userInstance).not.toBeNull();
      });

      it("makes the object persisted", async () => {
        expect(userInstance.persisted).toBeFalsy();
        await userInstance.save();
        expect(userInstance).toBeTruthy();
      });

      it("can be retrived from db", async () => {
        await userInstance.save();
        const { rows: [result] } = await db.queryObject<
          { rowFound: true } | null
        >(
          `
          SELECT true "rowFound"
          FROM users
          WHERE id = $1
        `,
          [userInstance.id],
        );
        expect(result?.rowFound).toBeTruthy();
      });
    });

    describe("update()", () => {
      it("throws if its called on a non persisted instance", () => {
        const nonPersisted = new User();
        expect(nonPersisted.update({ first_name: "_" })).rejects.toThrow(
          "model instance is not persisted yet",
        );
      });

      it("calls static update()", async () => {
        using updateSpy = stub(User, "update");
        const user = await User.create({ first_name: "_", last_name: "" });
        user.update({
          first_name: "stubbed",
        });

        assertSpyCalls(updateSpy, 1);
        assertSpyCall(updateSpy, 0, {
          args: [user.id, { first_name: "stubbed" }],
        });
      });

      it("returns the instance itself", async () => {
        const updated = await userInstance.save().then(() =>
          userInstance.update({ first_name: "_" })
        );
        expect(updated).toStrictEqual(userInstance);
      });
    });
  });
});
