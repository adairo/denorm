// deno-lint-ignore-file no-explicit-any
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "jsr:@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "jsr:@std/testing/mock";
import Orm, { type ModelDefinition } from "./model.ts";
import { expect } from "jsr:@std/expect";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { select } from "./queries.ts";

describe("Orm class", () => {
  describe("constructor", () => {
    it("initializes and exposes client", () => {
      const orm = new Orm();
      expect(orm.client).toBeInstanceOf(Client);
    });
  });

  describe("Orm.client", () => {
    it("can connect to and end connection from db", async () => {
      const orm = new Orm();
      await expect((async () => {
        await orm.client.connect();
        await orm.client.end();
        return true;
      })()).resolves
        .toBe(true);
    });
  });

  describe("Orm.prototype.defineModel", () => {
    it("stores the Model definition", () => {
      const modelDefinition = {
        modelName: "Model",
        tableName: "models",
        columns: { id: { type: "integer", primaryKey: true } },
      } satisfies ModelDefinition;
      const Model = new Orm().defineModel(modelDefinition);
      expect(Model.modelDefinition).toEqual(modelDefinition);
      expect(Model.modelName).toEqual("Model");
    });

    it("identifies the primaryKey", () => {
      const Model = new Orm().defineModel({
        modelName: "_",
        tableName: "_",
        columns: {
          id: "integer",
          uuid: { type: "uuid", primaryKey: true },
        },
      });
      expect(Model.primaryKeyColumn).toBe("uuid");
    });

    it("throws if the model does not define a primaryKey", () => {
      expect(() =>
        new Orm().defineModel({
          modelName: "_",
          tableName: "_",
          columns: { id: "integer" },
        })
      ).toThrow();
    });

    it("throws if the model defines more than one primaryKey", () => {
      expect(() =>
        new Orm().defineModel({
          modelName: "_",
          tableName: "_",
          columns: {
            id: { type: "integer", primaryKey: true },
            uuid: { type: "uuid", primaryKey: true },
          },
        })
      ).toThrow();
    });
  });
});

describe("Extended Model class", () => {
  const orm = new Orm();
  class Extended extends orm.defineModel({
    modelName: "Extended",
    columns: { id: { type: "text", primaryKey: true } },
    tableName: "_",
  }) {}

  describe("build", () => {
    it("returns an instance of the Extended class", () => {
      expect(Extended.build({})).toBeInstanceOf(Extended);
    });
  });
});

describe("Unextended Model class", () => {
  const orm = new Orm();

  beforeAll(async () => {
    await orm.client.queryObject(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name TEXT,
        last_name TEXT
      )`);
  });

  beforeEach(async () => {
    await orm.client.queryObject(`
      TRUNCATE users
    `);
  });

  afterAll(async () => {
    await orm.client.queryObject(`
      DROP TABLE users
    `);
    await orm.client.end();
  });

  const User = orm.defineModel({
    modelName: "User",
    tableName: "users",
    columns: {
      id: { type: "integer", primaryKey: true },
      first_name: "text",
      last_name: "text",
    },
  });

  describe("static methods", () => {
    describe("Model.build()", () => {
      it("creates a non persisted instance", () => {
        const user = User.build({});
        expect(user).toBeInstanceOf(User);
        expect(user.persisted).toBe(false);
      });

      it("stores the dataValues", () => {
        const userData = { first_name: "Foo", last_name: "Bar" };
        const user = User.build(userData);
        expect(user.dataValues).toMatchObject(userData);
      });

      it("creates property accesors for dataValues", () => {
        const userData = { first_name: "Foo", last_name: "Bar" };
        const user = User.build(userData);
        expect(user).toHaveProperty("first_name", userData.first_name);
        expect(user).toHaveProperty("last_name", userData.last_name);
      });
    });

    describe("Model.create()", () => {
      it("returns a model instance", async () => {
        const user = await User.create({
          first_name: "_",
          last_name: "_",
        });
        expect(user).toBeInstanceOf(User);
      });

      it("stores the values passed", async () => {
        const user = await User.create({
          first_name: "correct",
          last_name: "values",
        });
        expect(user.first_name).toBe("correct");
        expect(user.last_name).toBe("values");
      });
    });

    describe("Model.findByPk()", () => {
      let user = new User();
      const userData = { first_name: "Find", last_name: "Method" };

      beforeEach(async () => {
        user = await User.build(userData).save();
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
        expect(User.find(-1)).rejects.toThrow(
          "User with id=-1 does not exist",
        );
      });
    });

    describe("Model.update()", () => {
      let user = new User();

      beforeEach(async () => {
        user = await User.create({
          first_name: "John",
          last_name: "Values",
        });
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
        expect(result.first_name).toBeUndefined();
      });
    });

    describe("Model.delete()", () => {
      it("removes the row from db", async () => {
        const user = await User.create({ first_name: "_", last_name: "" });
        await User.delete({ where: { id: user.id } });
        expect(User.find(user.id)).rejects.toThrow("does not exist");
      });

      it("returns the specified columns from deleted row", async () => {
        const user = await User.create({ first_name: "foo", last_name: "" });
        const [result] = await User.delete({
          where: { id: user.id },
          returning: ["id", "first_name"],
        });
        expect(result.id).toBe(user.id);
        expect(result.first_name).toBe(user.first_name);
        expect(result.last_name).toBeUndefined();
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
    describe("setters", () => {
      let user = new User();

      beforeEach(() => {
        user = User.build({ first_name: "Foo", last_name: "Bar" });
      });

      it("mutates the instance", () => {
        user.last_name = "Updated";
        expect(user.last_name).toBe("Updated");
      });

      it("does not mutate db values", async () => {
        await user.save();
        user.last_name = "Updated";
        const [retrieved] = await User.select(["last_name"], {
          where: {
            id: user.id,
          },
        });
        expect(retrieved.last_name).not.toBe("Updated");
      });
    });

    describe("Model.prototype.set()", () => {
      let user = new User();

      beforeEach(() => {
        user = User.build({ first_name: "Foo", last_name: "Bar" });
      });

      it("stores multiple values passed", () => {
        const updatedData = { first_name: "Changed", id: 10 };
        user.set(updatedData);
        const { first_name, id } = user;
        expect({ first_name, id }).toEqual(updatedData);
      });
    });

    describe("Model.prototype.update()", () => {
      let user = new User();

      beforeEach(async () => {
        user = await User.create({ first_name: "John", last_name: "Values" });
      });

      it("throws if its called on a non persisted instance", () => {
        const nonPersisted = new User();
        expect(nonPersisted.update({ first_name: "_" })).rejects.toThrow(
          "model instance is not persisted yet",
        );
      });

      it("calls set() with the new values", async () => {
        using setStub = stub(user, "set");
        await user.update({ first_name: "New" });
        assertSpyCalls(setStub, 1);
        assertSpyCall(setStub, 0, {
          args: [{ first_name: "New" }],
        });
      });

      it("calls Model.update() with new values", async () => {
        using updateStub = stub(User, "update");
        await user.update({
          first_name: "stubbed",
        });

        assertSpyCalls(updateStub, 1);
        assertSpyCall(updateStub, 0, {
          args: [{
            set: { first_name: "stubbed" },
            where: { id: user.id },
          }],
        });
      });

      it("returns the instance itself", async () => {
        const updated = await user.update({ first_name: "_" });
        expect(updated).toStrictEqual(user);
      });
    });

    describe("Model.prototype.save()", () => {
      describe("when the instance is not persisted yet", () => {
        it("sets the primaryKey and set instance as persisted", async () => {
          const user = User.build({ first_name: "_" });
          expect(user.primaryKey).toBeNull();
          expect(user.persisted).toBeFalsy();
          await user.save();
          expect(user.primaryKey).not.toBeNull();
          expect(user.persisted).toBeTruthy();
        });

        it("can be retrived from db", async () => {
          const user = await User.build({ first_name: "_" }).save();
          const { rows: [retrieved] } = await select(orm.client, [
            "id",
            "first_name",
          ], {
            from: "users",
            where: { id: user.id },
          });
          expect(retrieved.id).toBeDefined();
          expect(retrieved.first_name).toBe("_");
        });
      });

      describe("when the instance is already persisted", () => {
        it("saves the new values on db", async () => {
          const user = await User.build({ first_name: "bar" }).save();
          await user.setDataValue("first_name", "foo").save();
          const { rows: [retrieved] } = await select(orm.client, [
            "first_name",
          ], {
            from: "users",
            where: { id: user.id },
          });
          expect(retrieved.first_name).toBe("foo");
        });
      });
    });

    describe("Model.prototype.delete()", () => {
      it("throws if the instance is not persisted", () => {
        const user = new User();
        expect(user.delete()).rejects.toThrow(
          "model instance is not persisted",
        );
      });

      it("calls Model.delete() with the instance primaryKey", async () => {
        const user = await User.create({ first_name: "foo" });
        using deleteStub = stub(User, "delete");
        await user.delete();
        assertSpyCalls(deleteStub, 1);
        assertSpyCall(deleteStub, 0, {
          args: [{ where: { id: user.id } }],
        });
      });

      it("sets the instance as not persisted", async () => {
        const user = await User.create({ first_name: "_" });
        await user.delete();
        expect(user.persisted).toBeFalsy();
      });

      it("sets the instance as deleted", async () => {
        const user = await User.create({ first_name: "_" });
        await user.delete();
        expect(user.deleted).toBeTruthy();
      });
    });

    describe("Model.prototype.reload()", () => {
      it("reloads the instance data from db", async () => {
        const user = await User.create({ first_name: "initial" });
        await User.update({
          set: { first_name: "updated" },
          where: { id: user.id },
        });

        await user.reload();
        expect(user.first_name).toBe("updated");
      });

      it("throws if the instance is not persisted", () => {
        const user = new User();
        expect(user.reload()).rejects.toThrow(
          "model instance is not persisted",
        );
      });
    });
  });
});
