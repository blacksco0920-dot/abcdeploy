import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const ts = require("typescript");

export function resolveInvokeReference(expression, bindingKinds) {
  expression = unwrapTransparentExpression(expression);

  if (ts.isIdentifier(expression)) {
    const binding = resolveBinding(expression);
    const role = binding && bindingKinds.get(binding);
    return role ? { binding, role } : undefined;
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "invoke"
  ) {
    const namespace = unwrapTransparentExpression(expression.expression);
    if (ts.isIdentifier(namespace)) {
      const binding = resolveBinding(namespace);
      const role = binding && bindingKinds.get(binding);
      if (role?.kind === "namespace") {
        return { binding, role: { kind: "invoke", depth: 0 } };
      }
    }
  }

  return undefined;
}

export function expressionContainsInvokeReference(expression, bindingKinds) {
  let found = false;

  function visit(node) {
    if (found || ts.isTypeNode(node)) {
      return;
    }
    const target = resolveInvokeReference(node, bindingKinds);
    if (
      target?.role.kind === "invoke" ||
      target?.role.kind === "unsupported"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return found;
}

export function isConstVariableDeclaration(declaration) {
  return Boolean(
    ts.getCombinedNodeFlags(declaration.parent) & ts.NodeFlags.Const,
  );
}

export function addUnsupportedBindingNames(name, bindingKinds) {
  if (ts.isIdentifier(name)) {
    bindingKinds.set(name, { kind: "unsupported" });
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      addUnsupportedBindingNames(element.name, bindingKinds);
    }
  }
}

export function bindingPatternSelectsNamespaceInvoke(
  name,
  initializer,
  bindingKinds,
) {
  if (!ts.isObjectBindingPattern(name)) {
    return false;
  }
  const namespace = resolveNamespaceReference(initializer, bindingKinds);
  return Boolean(
    namespace &&
      name.elements.some(
        (element) =>
          !element.dotDotDotToken &&
          propertyNameText(element.propertyName ?? element.name) === "invoke",
      ),
  );
}

export function assignmentPatternSelectsNamespaceInvoke(
  left,
  right,
  bindingKinds,
) {
  left = unwrapTransparentExpression(left);
  if (!ts.isObjectLiteralExpression(left)) {
    return false;
  }
  const namespace = resolveNamespaceReference(right, bindingKinds);
  return Boolean(
    namespace &&
      left.properties.some((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          return property.name.text === "invoke";
        }
        if (ts.isPropertyAssignment(property)) {
          return propertyNameText(property.name) === "invoke";
        }
        return false;
      }),
  );
}

export function resolveAssignedBindings(target) {
  const identifiers = [];
  collectAssignedIdentifiers(unwrapTransparentExpression(target), identifiers);
  return identifiers
    .map((identifier) => resolveBinding(identifier))
    .filter(Boolean);
}

export function isAssignmentOperator(kind) {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

export function resolveUnsupportedNamespaceInvokeReference(
  node,
  bindingKinds,
) {
  node = unwrapTransparentExpression(node);
  if (
    !ts.isElementAccessExpression(node) ||
    !node.argumentExpression ||
    !ts.isStringLiteral(node.argumentExpression) ||
    node.argumentExpression.text !== "invoke"
  ) {
    return undefined;
  }
  return resolveNamespaceReference(node.expression, bindingKinds);
}

export function isAllowedInvokeReferenceUse(node, target, bindingKinds) {
  let expression = node;
  while (
    expression.parent &&
    isTransparentExpression(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }

  if (
    ts.isCallExpression(expression.parent) &&
    expression.parent.expression === expression
  ) {
    return true;
  }

  const declaration = expression.parent;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer === expression &&
    ts.isIdentifier(declaration.name) &&
    isConstVariableDeclaration(declaration) &&
    target.role.kind === "invoke" &&
    target.role.depth === 0
  ) {
    const aliasRole = bindingKinds.get(declaration.name);
    return aliasRole?.kind === "invoke" && aliasRole.depth === 1;
  }

  return false;
}

export function isDeclarationBindingName(node) {
  if (!ts.isIdentifier(node)) {
    return false;
  }
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (
    ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportClause(parent)
  ) {
    return true;
  }
  return Boolean(
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
      parent.name === node,
  );
}

function unwrapTransparentExpression(expression) {
  while (isTransparentExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function isTransparentExpression(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

function resolveNamespaceReference(expression, bindingKinds) {
  expression = unwrapTransparentExpression(expression);
  if (!ts.isIdentifier(expression)) {
    return undefined;
  }
  const binding = resolveBinding(expression);
  return bindingKinds.get(binding)?.kind === "namespace" ? binding : undefined;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function collectAssignedIdentifiers(target, identifiers) {
  if (ts.isIdentifier(target)) {
    identifiers.push(target);
    return;
  }
  if (ts.isArrayLiteralExpression(target)) {
    for (const element of target.elements) {
      collectAssignedIdentifiers(element, identifiers);
    }
    return;
  }
  if (ts.isObjectLiteralExpression(target)) {
    for (const property of target.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        identifiers.push(property.name);
      } else if (ts.isPropertyAssignment(property)) {
        collectAssignedIdentifiers(property.initializer, identifiers);
      } else if (ts.isSpreadAssignment(property)) {
        collectAssignedIdentifiers(property.expression, identifiers);
      }
    }
    return;
  }
  if (
    ts.isBinaryExpression(target) &&
    target.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    collectAssignedIdentifiers(target.left, identifiers);
    return;
  }
  if (ts.isSpreadElement(target)) {
    collectAssignedIdentifiers(target.expression, identifiers);
  }
}

function resolveBinding(identifier) {
  for (let parent = identifier.parent; parent; parent = parent.parent) {
    const declarations = scopeBindingDeclarations(parent, identifier.text);
    if (declarations.length > 0) {
      return declarations.length === 1 ? declarations[0] : undefined;
    }
  }

  return undefined;
}

function scopeBindingDeclarations(node, bindingName) {
  const declarations = [];

  if (ts.isSourceFile(node)) {
    collectVarBindings(node, declarations, bindingName);
    addLexicalBindings(node.statements, declarations, bindingName);
    for (const statement of node.statements) {
      if (ts.isImportDeclaration(statement)) {
        addImportBindings(statement, declarations, bindingName);
      }
    }
  } else if (ts.isFunctionLike(node)) {
    for (const parameter of node.parameters) {
      addBindingName(parameter.name, declarations, bindingName);
    }
    if (ts.isFunctionExpression(node) && node.name) {
      addBindingName(node.name, declarations, bindingName);
    }
    if (node.body) {
      collectVarBindings(node.body, declarations, bindingName);
    }
  } else if (ts.isBlock(node) || ts.isModuleBlock(node)) {
    addLexicalBindings(node.statements, declarations, bindingName);
  } else if (ts.isCatchClause(node) && node.variableDeclaration) {
    addBindingName(node.variableDeclaration.name, declarations, bindingName);
  } else if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      addVariableBindings(node.initializer, declarations, bindingName);
    }
  } else if (ts.isCaseBlock(node)) {
    for (const clause of node.clauses) {
      addLexicalBindings(clause.statements, declarations, bindingName);
    }
  }

  return declarations;
}

function addLexicalBindings(statements, declarations, bindingName) {
  for (const statement of statements) {
    if (
      ts.isVariableStatement(statement) &&
      isBlockScopedVariableDeclarationList(statement.declarationList)
    ) {
      addVariableBindings(statement.declarationList, declarations, bindingName);
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      addBindingName(statement.name, declarations, bindingName);
    }
  }
}

function addImportBindings(statement, declarations, bindingName) {
  const clause = statement.importClause;
  if (!clause) {
    return;
  }

  if (clause.name) {
    addBindingName(clause.name, declarations, bindingName);
  }
  if (!clause.namedBindings) {
    return;
  }
  if (ts.isNamespaceImport(clause.namedBindings)) {
    addBindingName(clause.namedBindings.name, declarations, bindingName);
    return;
  }

  for (const element of clause.namedBindings.elements) {
    addBindingName(element.name, declarations, bindingName);
  }
}

function collectVarBindings(node, declarations, bindingName) {
  function visit(child) {
    if (
      child !== node &&
      (ts.isFunctionLike(child) ||
        ts.isClassDeclaration(child) ||
        ts.isClassExpression(child))
    ) {
      return;
    }
    if (
      ts.isVariableDeclaration(child) &&
      ts.isVariableDeclarationList(child.parent) &&
      !isBlockScopedVariableDeclarationList(child.parent)
    ) {
      addBindingName(child.name, declarations, bindingName);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
}

function isBlockScopedVariableDeclarationList(declarationList) {
  return Boolean(
    ts.getCombinedNodeFlags(declarationList) & ts.NodeFlags.BlockScoped,
  );
}

function addVariableBindings(declarationList, declarations, bindingName) {
  for (const declaration of declarationList.declarations) {
    addBindingName(declaration.name, declarations, bindingName);
  }
}

function addBindingName(name, declarations, bindingName) {
  if (ts.isIdentifier(name)) {
    if (name.text === bindingName) {
      declarations.push(name);
    }
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      addBindingName(element.name, declarations, bindingName);
    }
  }
}
