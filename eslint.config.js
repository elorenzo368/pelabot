// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "bin/**", "vendor/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.js", "*.config.ts", ".prettierrc"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // ADR-010: the music domain must never see discord.js or
    // @discordjs/voice directly — every Discord question it needs answered
    // becomes a port implemented by discord/, never an import.
    files: ["src/music/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "discord.js",
              message:
                "src/music/** must not import discord.js — depend on a port instead (see design §5).",
            },
            {
              name: "@discordjs/voice",
              message:
                "src/music/** must not import @discordjs/voice — depend on the VoiceGateway port instead (see design §5).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
