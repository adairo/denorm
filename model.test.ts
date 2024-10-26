// deno-lint-ignore-file no-explicit-any
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "jsr:@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "jsr:@std/testing/mock";
import Orm from "./model.ts";
import { expect } from "jsr:@std/expect";

describe({
  name: "defineModel function",
}, () => {
  const orm = new Orm();
  it("stores the Model definition", () => {
    const modelDefinition = {
      tableName: "models",
      columns: { id: { type: "integer", primaryKey: true } },
    } as const;
    const Model = orm.defineModel("Model", modelDefinition);
    expect(Model.modelDefinition).toEqual(modelDefinition);
  });

  it("throws if the model does not define a primaryKey", () => {
    expect(() =>
      orm.defineModel("_", {
        tableName: "_",
        columns: { id: "integer" },
      })
    ).toThrow();
  });
});

describe("Extended Model class", () => {
  const orm = new Orm();
  class Extended extends orm.defineModel("Original", {
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

  const User = orm.defineModel("User", {
    tableName: "users",
    columns: {
      id: { type: "integer", primaryKey: true },
      first_name: "text",
      last_name: "text",
    },
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
        const ModelWithPk = orm.defineModel("_", {
          tableName: "_",
          columns: {
            id: "integer",
            uuid: { type: "uuid", primaryKey: true },
          },
        });
        const user = ModelWithPk.build({ id: 1, uuid: "abc" });
        expect(user.primaryKey).toBe("abc");
        expect(ModelWithPk.primaryKeyColumn).toBe("uuid");
      });

      it("creates a non persisted instance", () => {
        const user = User.build({ first_name: "Foo" });
        expect(user.persisted).toBe(false);
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
        await User.delete({ where: { id: user.id } });
        expect(User.find(user.id)).rejects.toThrow("does not exist");
      });

      it("can return the id of deleted row", async () => {
        const user = await User.create({ first_name: "_", last_name: "" });
        const [result] = await User.delete({
          where: { id: user.id },
          returning: "id",
        });
        expect(result.id).toBe(user.id);
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

    describe("using setters to set properties", () => {
      it("mutates the instance", () => {
        userInstance.last_name = "Updated";
        expect(userInstance.last_name).toBe("Updated");
      });

      it("does not mutate db values", async () => {
        await userInstance.save();
        userInstance.last_name = "Updated";
        const [retrieved] = await User.select(["last_name"], {
          where: {
            id: userInstance.id,
          },
        });
        expect(retrieved.last_name).not.toBe("Updated");
      });
    });

    describe("Model.prototype.set()", () => {
      it("stores multiple values passed", () => {
        const updatedData = { first_name: "Changed", id: 10 };
        userInstance.set(updatedData);
        const { first_name, id } = userInstance;
        expect({ first_name, id }).toEqual(updatedData);
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

        using setStub = stub(user, "set");
        await user.update({ first_name: "New" });
        assertSpyCalls(setStub, 1);
        assertSpyCall(setStub, 0, {
          args: [{ first_name: "New" }],
        });
      });

      it("calls Model.update() with the new values", async () => {
        const user = await User.create({ first_name: "Foo", last_name: "Bar" });
        using ModelUpdate = stub(User, "update");
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
        const updated = await userInstance.save().then(
          (u) => u.update({ first_name: "_" }),
        );
        expect(updated).toStrictEqual(userInstance);
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
      });

      it("can be retrived from db", async () => {
        const user = await User.build({ first_name: "_" }).save();

        const [retrieved] = await User.select(["id", "first_name"], {
          where: { id: user.id },
        });
        expect(retrieved.primaryKey).toBeDefined();
        expect(retrieved.first_name).toBe("_");
      });
    });

    describe("Model.prototype.delete()", () => {
    });
  });
});
