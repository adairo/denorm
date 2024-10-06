import ActiveRecord from "./active-record.ts";

class User extends ActiveRecord {}
User.init("users")

const user = await User.create({ first_name: "Adair" });

console.log(user)