import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "jsr:@std/testing/bdd";
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

describe("Unextended Model class", function () {
  let db: Client;

  beforeAll(async () => {
    db = new Client();
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  const modelDefinition = {
    tableName: "users",
    columns: {
      id: { type: "integer", primaryKey: true },
      firstName: "string",
      lastName: "string",
    },
  } as const;

  let User = defineModel("User", modelDefinition);

  beforeEach(() => {
    User = defineModel("User", modelDefinition, db);
  });

  describe("static methods", () => {
    describe("build", () => {
      it("stores the dataValues", () => {
        const userData = { firstName: "Foo", lastName: "Bar", id: 1 };
        const user = User.build(userData);
        expect(user.dataValues).toEqual(userData);
      });

      it("creates property accesors for dataValues", () => {
        const userData = { firstName: "Foo", lastName: "Bar", id: 1 };
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
        const user = User.build({ firstName: "Foo" });
        expect(user.persisted).toBe(false);
      });
    });
  });

  describe("instance methods", () => {
    const userData = { firstName: "Foo", lastName: "Bar", id: 1 };
    let userInstance = User.build({});
    beforeEach(() => {
      userInstance = User.build(userData);
    });

    describe("set method", () => {
      it("stores multiple values passed", () => {
        const updatedData = { firstName: "Changed", id: 10 };
        userInstance.set(updatedData);
        const { firstName, id } = userInstance;
        expect({ firstName, id }).toEqual(updatedData);
      });
    });

    describe("save method", () => {
      /* it.skip("when saving the primaryKey is saved", async () => {
        expect(userInstance.primaryKey).toBeNull();
        await userInstance.save();
        expect(userInstance).not.toBeNull();
      }); */
    });
  });
});
