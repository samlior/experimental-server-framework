import { randomBytes } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { Sequelize, DataTypes, Model } from "sequelize";
import { Limited, RequestStatus, Token } from "./limited";
import {
  ReturnTypeIs,
  run,
  runNoExcept,
  raceNoExcept,
  toNoExcept,
} from "./scheduler";

dotenv.config({ path: path.join(__dirname, "../.env") });

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
    `postgres://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
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

export async function* doSomething2(sequelize: Sequelize): ReturnTypeIs<void> {
  // 开启事务
  const {
    ok,
    error,
    result: transaction,
  } = yield* runNoExcept(toNoExcept(sequelize.transaction()));
  if (!ok) {
    // 这里必须判断, 如果开启事务成功,
    // 但遇到中断错误的话, 需要回滚事务
    if (transaction) {
      await transaction.rollback();
    }
    throw error;
  }

  try {
    const name = randomBytes(32).toString("hex");
    const age = 18;
    // 增
    const user = yield* run(User.create({ name, age }, { transaction }));
    // 查
    yield* run(User.findAll({ where: { name }, transaction }));
    // 改
    user.age = 19;
    yield* run(user.save({ transaction }));
    // 删
    yield* run(user.destroy({ transaction }));
    // 这里不用判断, 阻塞提交事务
    await transaction.commit();
  } catch (error) {
    // 这里不用判断, 阻塞的回滚事务就行
    await transaction.rollback();
    throw error;
  }
}

export async function* limitedDoSomething(
  limited: Limited,
  sequelize: Sequelize
) {
  const { request, getToken } = limited.get();
  let token: Token;
  if (request) {
    const { ok, error, result } = yield* raceNoExcept(toNoExcept(getToken));
    if (!ok) {
      if (request.value.status === RequestStatus.Queued) {
        limited.cancel(request);
      } else if (result) {
        limited.put(result);
      }
      throw error;
    }
    token = result;
  } else {
    token = await getToken;
  }

  try {
    yield* token.invoke2(doSomething2(sequelize));
  } finally {
    limited.put(token);
  }
}

export async function destroyDB(sequelize: Sequelize) {
  await sequelize.close();
}
