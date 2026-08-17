// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "bin/**", "vendor/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.config.js",
            "*.config.ts",
            ".prettierrc",
            "scripts/*.mjs",
            "scripts/*.ts",
            "scripts/lib/*.mjs",
          ],
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
    // Plain JS ops scripts (download/checksum/spawn helpers): the ephemeral
    // single-file "default project" TS gives them (allowDefaultProject
    // above) doesn't carry full Node type info, so type-aware rules see
    // `any` at nearly every Node core-module call. Same relaxation the
    // project already applies to `**/*.test.ts` below, extended to these
    // untyped-by-design files rather than fighting the checker on files
    // that were never meant to be strictly typed.
    files: ["scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
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
