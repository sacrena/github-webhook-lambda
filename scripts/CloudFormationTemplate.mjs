import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { artifactLocations, artifactVersion, repositoryRoot } from "./DeploymentUtilities.mjs";

const intrinsicNames = { "!Ref": "Ref", "!Sub": "Fn::Sub", "!GetAtt": "Fn::GetAtt" };
const schema = yaml.DEFAULT_SCHEMA.extend(Object.entries(intrinsicNames).map(([tag, name]) =>
  new yaml.Type(tag, {
    kind: "scalar",
    construct: (value) => ({ [name]: tag === "!GetAtt" ? value.split(/\.(.*)/s).slice(0, 2) : value }),
  })));

/**
 * Reads a component template with the intrinsic tags used by this repository.
 * Converting short YAML tags into their JSON equivalents lets composition
 * resolve component boundaries without replacing resource identities.
 * Unsupported tags fail parsing instead of being silently discarded.
 * Secret values remain parameter references throughout this operation.
 */
function readTemplate(filename) {
  return yaml.load(readFileSync(filename, "utf8"), { schema });
}

/**
 * Combines the root's component wiring into one deployable CloudFormation stack.
 * The source templates remain separate, but their resource logical IDs are
 * preserved in the existing Lambda stack so no ownership migration is needed.
 * Component parameters resolve through the root's bindings and output links.
 * Duplicate resource IDs fail rather than overwriting another component.
 * This supports the repository's direct component stacks, not recursive nesting.
 */
export function composeTemplate(root, components) {
  /**
   * Resolves a value within its component's parameter and output context.
   * Root parameter references remain intact for CloudFormation to evaluate.
   * Component outputs may refer to other components through root bindings;
   * substitution variable maps preserve those references inside strings.
   * All ordinary resource references retain their existing logical names.
   */
  function resolve(value, scope) {
    if (Array.isArray(value)) return value.map((item) => resolve(item, scope));
    if (value === null || typeof value !== "object") return value;

    const bindings = scope ? root.Resources[scope].Properties.Parameters ?? {} : {};
    if (value.Ref && Object.hasOwn(bindings, value.Ref))
      return resolve(bindings[value.Ref]);

    if (value["Fn::GetAtt"]) {
      const [resource, attribute] = value["Fn::GetAtt"];
      if (Object.hasOwn(components, resource)) {
        const output = components[resource].Outputs?.[attribute.replace(/^Outputs\./, "")];
        if (!attribute.startsWith("Outputs.") || !output)
          throw new Error(`Unknown component output: ${resource}.${attribute}`);

        return resolve(output.Value, resource);
      }
    }

    if (typeof value["Fn::Sub"] === "string") {
      const expression = value["Fn::Sub"];
      const variables = Object.fromEntries(Object.entries(bindings)
        .filter(([name]) => expression.includes(`\${${name}}`))
        .map(([name, binding]) => [name, resolve(binding)]));

      return { "Fn::Sub": Object.keys(variables).length ? [expression, variables] : expression };
    }

    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, scope)]));
  }

  const resources = {};
  for (const [scope, component] of Object.entries(components)) {
    for (const [name, resource] of Object.entries(component.Resources)) {
      if (Object.hasOwn(resources, name)) throw new Error(`Duplicate resource logical ID: ${name}`);
      if (resource.Type === "AWS::CloudFormation::Stack") throw new Error("Recursive component stacks are unsupported");
      resources[name] = resolve(resource, scope);
    }
  }

  return { ...root, Resources: resources, Outputs: resolve(root.Outputs) };
}

/**
 * Writes the single-stack deployment artifact consumed by validation and deploy.
 * The root YAML describes how the source components connect; the generated
 * JSON places their resources directly in the existing Lambda stack instead.
 * Output lives under the ignored version directory alongside the Lambda ZIP.
 * It contains parameter declarations and references, never supplied secrets.
 * Both workflows call this builder so they validate and deploy the same layout.
 */
export function buildTemplate() {
  const sourceDirectory = path.join(repositoryRoot, "cloudformation");
  const root = readTemplate(path.join(sourceDirectory, "agent-setup.yaml"));
  const components = Object.fromEntries(Object.entries(root.Resources).map(([name, resource]) => {
    if (resource.Type !== "AWS::CloudFormation::Stack") throw new Error(`Expected component: ${name}`);
    return [name, readTemplate(path.join(sourceDirectory, resource.Properties.TemplateURL))];
  }));

  const template = composeTemplate(root, components);
  const artifact = artifactLocations(artifactVersion());
  const filename = path.join(artifact.directory, "agent-setup.json");
  mkdirSync(artifact.directory, { recursive: true });
  writeFileSync(filename, JSON.stringify(template, null, 2));

  return filename;
}
