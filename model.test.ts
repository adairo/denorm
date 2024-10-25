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

  let User = defineModel("User", modelDefinition, db!);

  beforeEach(() => {
    User = defineModel("User", modelDefinition, db) as any;
  });

  describe("static methods", () => {
    describe("Model.build()", () => {
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

    describe("Model.create()", () => {
      it("directly creates a persisted instance", async () => {
        const user = await User.create({
          first_name: "Foo",
          last_name: "Bar",
        });
        expect(user.persisted).toBeTruthy();
        expect(user.primaryKey).toBeDefined();
      });
    });

    describe("Model.insert()", () => {
      it("returns a model instance", async () => {
        const user = await User.insert({
          values: { first_name: "_", last_name: "_" },
        });
        expect(user).toBeInstanceOf(User);
      });

      it("saves the values passed", async () => {
        const user = await User.insert({
          values: { first_name: "correct", last_name: "values" },
        });
        expect(user.first_name).toBe('correct');
        expect(user.last_name).toBe('values');
      });

      it("returns a persisted instance with primaryKey", async () => {
        const user = await User.insert({
          values: { first_name: "correct", last_name: "values" },
        });
        expect(user.primaryKey).not.toBeNull()
        expect(user.persisted).toBeTruthy()
      });
    });

    describe("Model.find()", () => {
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

    describe("Model.update()", () => {
      let user = new User();
      const initialValues = {
        first_name: "John",
        last_name: "Values",
      };

      beforeEach(async () => {
        user = await User.create(initialValues);
      });

      it("Updates values on db", async () => {
        await User.update({
          set: { first_name: "Updated" },
          where: { id: user.id },
        });
        const retrieved = await User.find(user.id);
        expect(retrieved.first_name).toBe("Updated");
      });

      it("Returns the specified columns", async () => {
        const [result] = await User.update({
          set: { first_name: "Updated" },
          where: { id: user.id },
          returning: ["id"],
        });
        expect(result.id).toBe(user.id);
      });
    });

    describe("Model.delete()", () => {
      it("removes the row from db", async () => {
        const user = await User.create({ first_name: "_", last_name: "" });
        await User.delete(user.id);
        expect(User.find(user.id)).rejects.toThrow("does not exist");
      });

      it("returns the id of deleted row", async () => {
        const user = await User.create({ first_name: "_", last_name: "" });
        const result = await User.delete(user.id);
        expect(result).toBe(user.id);
      });

      it("Throws if no row was deleted", () => {
        expect(User.delete(-1)).rejects.toThrow("it was not found");
      });
    });

    describe("Model.columns()", () => {
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

    describe("Model.prototype.set()", () => {
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

    describe("Model.prototype.save()", () => {
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

    describe("Model.prototype.update()", () => {
      it("throws if its called on a non persisted instance", () => {
        const nonPersisted = new User();
        expect(nonPersisted.update({ first_name: "_" })).rejects.toThrow(
          "model instance is not persisted yet",
        );
      });

      it("calls set() with the new values", async () => {
        const user = await User.create({ first_name: "Foo", last_name: "Bar" });
        const setStub = stub(user, "set");
        await user.update({ first_name: "New" });
        assertSpyCalls(setStub, 1);
        assertSpyCall(setStub, 0, {
          args: [{ first_name: "New" }],
        });
      });

      it("calls Model.update() with the new values", async () => {
        const user = await User.create({ first_name: "Foo", last_name: "Bar" });
        const ModelUpdate = stub(User, "update");
        await user.update({ first_name: "New" });
        assertSpyCalls(ModelUpdate, 1);
        assertSpyCall(ModelUpdate, 0, {
          args: [{ set: { first_name: "New" }, where: { id: user.id } }],
        });
      });

      it("calls Model.update()", async () => {
        using updateSpy = stub(User, "update");
        const user = await User.create({ first_name: "_", last_name: "" });
        user.update({
          first_name: "stubbed",
        });

        assertSpyCalls(updateSpy, 1);
        assertSpyCall(updateSpy, 0, {
          args: [{
            set: { first_name: "stubbed" },
            where: { id: user.id },
          }],
        });
      });

      it("returns the instance itself", async () => {
        const updated = await userInstance.save().then(() =>
          userInstance.update({ first_name: "_" })
        );
        expect(updated).toStrictEqual(userInstance);
      });
    });

    describe("Model.prototype.delete()", () => {
    });
  });
});
