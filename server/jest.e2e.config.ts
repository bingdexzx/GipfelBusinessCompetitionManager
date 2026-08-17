import type { Config } from "jest";

// M8 工程化收尾（T17）：e2e 冒烟专用 jest 配置。
// 与单元测试配置分离：仅匹配 *.e2e-spec.ts，且不参与 `npm test`（避免每次单测都启动整套应用）。
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.e2e-spec.ts"],
  // e2e 冒烟以「跑通主链路」为目标，放宽类型检查（isolatedModules）避免与业务类型纠缠。
  transform: {
    "^.+\\.ts$": ["ts-jest", { isolatedModules: true }],
  },
};

export default config;
