import {
  GraphQLArgument,
  GraphQLArgumentConfig,
  GraphQLEnumType,
  GraphQLField,
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFieldMap,
  GraphQLInputField,
  GraphQLInputFieldConfig,
  GraphQLInputFieldConfigMap,
  GraphQLInputFieldMap,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLType,
  GraphQLUnionType,
  GraphQLDirective,
  Kind,
  ValueNode,
  getNamedType,
  isNamedType,
  GraphQLInt,
  GraphQLFloat,
  GraphQLString,
  GraphQLBoolean,
  GraphQLID,
  GraphQLSchema,
} from 'graphql';

import {
  visitSchema,
  VisitSchemaKind,
} from 'graphql-tools/dist/transforms/visitSchema';

import {
  recreateType,
  createResolveType,
  fieldMapToFieldConfigMap,
  inputFieldMapToFieldConfigMap,
} from 'graphql-tools/dist/stitching/schemaRecreation';

import { visit, SelectionSetNode, BREAK, FieldNode } from 'graphql';

import TypeWrap from '@apollo-model/type-wrap';
import DefaultFields from './defaultFields';

import R from 'ramda';

// console.log({ Kind });

const capitalizeFirstLetter = string => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

const reduceArgs = (map, arg) => {
  map[arg.name] = arg;
  return map;
};

const getFields = stackItem => stackItem.type.getFields();
const getArgs = stackItem => stackItem.args;

const getNameValue = node => node.name.value;

const mapTypeForTypeStack = type => ({ type });

export const mapFieldForTypeStack = field => ({
  type: field.type,
  args: field.args.reduce(reduceArgs, {}),
});

const mapArgForTypeStack = arg => ({
  type: new TypeWrap(arg.type).realType(),
});

export const groupFields = (predicate, object) => {
  let result = {};
  for (let key in object) {
    let predicateValue = predicate(object[key]);
    if (!result[predicateValue]) result[predicateValue] = {};
    result[predicateValue][key] = object[key];
  }
  return result;
};

export const reduceValues = values => {
  return values.reduce((state, item) => {
    state[item.name] = R.omit(['deprecationReason', 'isDeprecated'], item);
    return state;
  }, {});
};

const resolveType = createResolveType((typeName, type) => {
  return type;
});

export default (filterFields, defaultFields) => {
  let typeMap = {};
  const getType = typeName => typeMap[typeName];

  let defaults = DefaultFields();

  return {
    transformRequest(request) {
      const typeStack = [];

      let newDocument = visit(request.document, {
        [Kind.OPERATION_DEFINITION]: {
          enter: node => {
            node.operation
              |> capitalizeFirstLetter
              |> getType
              |> mapTypeForTypeStack
              |> typeStack.push;
          },
          leave: node => {
            typeStack.pop();
          },
        },
        [Kind.FIELD]: {
          enter: node => {
            typeStack
              |> R.last
              |> getFields
              |> R.prop(getNameValue(node))
              |> mapFieldForTypeStack
              |> typeStack.push;
          },
          leave: node => {
            typeStack.pop();
          },
        },
        [Kind.ARGUMENT]: {
          enter: node => {
            typeStack
              |> R.last
              |> getArgs
              |> R.prop(getNameValue(node))
              |> mapArgForTypeStack
              |> typeStack.push;
          },
          leave: node => {
            return typeStack.pop() |> defaults.applyDefaults(node);
          },
        },
        [Kind.OBJECT_FIELD]: {
          enter: node => {
            typeStack
              |> R.last
              |> getFields
              |> R.prop(getNameValue(node))
              |> mapArgForTypeStack
              |> typeStack.push;
          },
          leave: node => {
            return typeStack.pop() |> defaults.applyDefaults(node);
          },
        },
      });

      return {
        ...request,
        document: newDocument,
      };
    },

    transformSchema(schema) {
      defaults = DefaultFields();

      let newSchema = visitSchema(schema, {
        [VisitSchemaKind.OBJECT_TYPE]: type => {
          const groupedFields = groupFields(
            field => filterFields(type, field),
            type.getFields()
          );

          if (!groupedFields[false]) {
            return undefined;
          }
          if (!groupedFields[true]) return null;

          const interfaces = type.getInterfaces();

          return new GraphQLObjectType({
            name: type.name,
            description: type.description,
            astNode: type.astNode,
            isTypeOf: type.isTypeOf,
            fields: () =>
              fieldMapToFieldConfigMap(groupedFields[true], resolveType, true),
            interfaces: () => interfaces,
          });

          return undefined;
        },
        [VisitSchemaKind.INPUT_OBJECT_TYPE]: type => {
          const groupedFields = groupFields(
            field => filterFields(type, field),
            type.getFields()
          );

          if (!groupedFields[false]) {
            return undefined;
          } else {
            Object.values(groupedFields[false]).forEach(field => {
              let defaultFn = defaultFields(type, field);
              if (defaultFn) {
                defaults.add(type, field, defaultFn);
              } else {
                if (new TypeWrap(field.type).isRequired()) {
                  throw new Error(
                    `Default value for required field "${field.name}" in type "${type.name}" was not provided`
                  );
                }
              }
            });
          }

          if (!groupedFields[true]) return null;

          return new GraphQLInputObjectType({
            name: type.name,
            description: type.description,
            astNode: type.astNode,
            isTypeOf: type.isTypeOf,
            fields: () =>
              inputFieldMapToFieldConfigMap(groupedFields[true], resolveType),
          });

          return undefined;
        },
        [VisitSchemaKind.ENUM_TYPE]: type => {
          const groupedFields = groupFields(
            field => filterFields(type, field),
            reduceValues(type.getValues())
          );

          if (!groupedFields[false]) {
            return undefined;
          }
          if (!groupedFields[true]) return null;

          return new GraphQLEnumType({
            name: type.name,
            description: type.description,
            astNode: type.astNode,
            values: groupedFields[true],
          });

          return undefined;
        },
        [VisitSchemaKind.INTERFACE_TYPE]: type => {
          const groupedFields = groupFields(
            field => filterFields(type, field),
            type.getFields()
          );

          if (!groupedFields[false]) {
            return undefined;
          }
          // else {
          //   Object.values(groupedFields[false]).forEach(field => {
          //     let defaultFn = defaultFields(type, field);
          //     if (defaultFn) {
          //       defaults.add(type, field, defaultFn);
          //     } else {
          //       if (new TypeWrap(field.type).isRequired()) {
          //         throw new Error(
          //           `Default value for required field "${field.name}" in type "${type.name}" was not provided`
          //         );
          //       }
          //     }
          //   });
          //

          if (!groupedFields[true]) return null;

          return new GraphQLInterfaceType({
            name: type.name,
            // description: type.description,
            astNode: type.astNode,
            // isTypeOf: type.isTypeOf,
            fields: () =>
              fieldMapToFieldConfigMap(groupedFields[true], resolveType),
          });

          return undefined;
        },
      });

      //remove null from interfaces after first transformation
      newSchema = visitSchema(newSchema, {
        [VisitSchemaKind.OBJECT_TYPE]: type => {
          const interfaces = type.getInterfaces();
          let filteredInterfaces = interfaces.filter(iface => iface);

          if (filteredInterfaces.length === interfaces.length) {
            return undefined;
          }

          const fields = type.getFields();

          return new GraphQLObjectType({
            name: type.name,
            description: type.description,
            astNode: type.astNode,
            isTypeOf: type.isTypeOf,
            fields: () => fieldMapToFieldConfigMap(fields, resolveType, true),
            interfaces: () => filteredInterfaces,
          });

          return undefined;
        },
      });

      typeMap = newSchema.getTypeMap();
      return newSchema;
    },
  };
};