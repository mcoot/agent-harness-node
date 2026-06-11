import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsonSchema, tool } from "ai";

export type ReadFileInput = {
  path: string;
};

export type ReadFileOutput = {
  path: string;
  content: string;
};

const readFileInputSchema = jsonSchema<ReadFileInput>({
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Path to a UTF-8 text file, relative to the current working directory.",
    },
  },
  required: ["path"],
  additionalProperties: false,
});

export function createReadFileTool(options: { rootDirectory?: string } = {}) {
  const rootDirectory = path.resolve(options.rootDirectory ?? process.cwd());

  return tool<ReadFileInput, ReadFileOutput>({
    description: "Read a UTF-8 text file from the local project directory.",
    inputSchema: readFileInputSchema,
    execute: async (input) => {
      const requestedPath = path.resolve(rootDirectory, input.path);
      const relativePath = path.relative(rootDirectory, requestedPath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Refusing to read outside the project directory: ${input.path}`);
      }

      const content = await readFile(requestedPath, "utf8");

      return {
        path: relativePath,
        content,
      };
    },
  });
}
