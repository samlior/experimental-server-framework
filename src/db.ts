import { randomBytes } from "node:crypto";
import { Sequelize, DataTypes, Model } from "sequelize";

const dataSize = 100000;

class User extends Model {
  declare name: string;
  declare age: number;
}

function initModel(sequelize: Sequelize) {
  User.init(
    {
      name: {
        type: DataTypes.STRING,
      },
      age: {
        type: DataTypes.INTEGER,
      },
    },
    {
      sequelize,
      modelName: "User",
    }
  );
}

export async function createDB(force: boolean) {
  const sequelize = new Sequelize(
    "postgres://postgres:12345678@localhost:5432/experimental-server-framework",
    { logging: false }
  );
  initModel(sequelize);
  await sequelize.authenticate();
  await sequelize.sync({ force });
  return sequelize;
}

export async function initData(sequelize: Sequelize) {
  const transaction = await sequelize.transaction();
  try {
    for (let i = 0; i < dataSize; i++) {
      const name = randomBytes(32).toString("hex");
      const age = 18;
      await User.create({ name, age }, { transaction });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function doSomething(sequelize: Sequelize) {
  // 开启事务
  const transaction = await sequelize.transaction();
  try {
    const name = randomBytes(32).toString("hex");
    const age = 18;
    // 增
    const user = await User.create({ name, age }, { transaction });
    // 查
    await User.findAll({ where: { name }, transaction });
    // 改
    user.age = 19;
    await user.save({ transaction });
    // 删
    await user.destroy({ transaction });
    // 提交事务
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function destroyDB(sequelize: Sequelize) {
  await sequelize.close();
}
