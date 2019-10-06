import * as DirectiveImplements from '@apollo-model/directive-implements';
import gql from 'graphql-tag';
import AMM from '../src';
import { applyInputTransform } from '../src/inputTypes/utils';
import { AMVisitor } from '../src/execution/visitor';
import { AMTransaction } from '../src/execution/transaction';

const generateSchema = typeDefs => {
  return new AMM({
    queryExecutor: null,
  }).makeExecutableSchema({
    resolverValidationOptions: {
      requireResolversForResolveType: false,
    },
    typeDefs: [typeDefs, DirectiveImplements.typeDefs],
    schemaDirectives: {
      ...DirectiveImplements.schemaDirectives,
    },
  });
};

describe('simple schema', () => {
  const schema = generateSchema(gql`
    type Post @model {
      id: ID @id @unique @db(name: "_id")
      title: String
    }
  `);

  test('multiple query', () => {
    const rq = gql`
      {
        posts {
          id
          title
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);
    expect(transaction).toMatchInlineSnapshot(`
                  Object {
                    "operations": Array [
                      Object {
                        "collectionName": "posts",
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                            "title",
                          ],
                        },
                        "identifier": "Operation-0",
                        "kind": "AMReadOperation",
                        "many": true,
                        "output": "AMResultPromise { Operation-0 }",
                      },
                    ],
                  }
            `);
  });

  test('create', () => {
    const rq = gql`
      mutation {
        createPost(data: { title: "test-title" }) {
          id
          title
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);
    expect(transaction).toMatchInlineSnapshot(`
                  Object {
                    "operations": Array [
                      Object {
                        "collectionName": "posts",
                        "data": Object {
                          "title": "test-title",
                        },
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                            "title",
                          ],
                        },
                        "identifier": "Operation-0",
                        "kind": "AMCreateOperation",
                        "many": false,
                        "output": "AMResultPromise { Operation-0 }",
                      },
                    ],
                  }
            `);
  });
});

describe('nested objects', () => {
  const schema = generateSchema(gql`
    type Post @model {
      id: ID @id @unique @db(name: "_id")
      title: String
      comments: [Comment]!
      pinnedComment: Comment
    }

    type Comment @embedded {
      message: String
    }
  `);

  test('create nested', () => {
    const rq = gql`
      mutation {
        createPost(
          data: {
            title: "test-title"
            pinnedComment: { create: { message: "comment-1" } }
          }
        ) {
          id
          title
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);
    expect(transaction).toMatchInlineSnapshot(`
      Object {
        "operations": Array [
          Object {
            "collectionName": "posts",
            "data": Object {
              "pinnedComment": Object {
                "message": "comment-1",
              },
              "title": "test-title",
            },
            "fieldsSelection": Object {
              "fields": Array [
                "_id",
                "title",
              ],
            },
            "identifier": "Operation-0",
            "kind": "AMCreateOperation",
            "many": false,
            "output": "AMResultPromise { Operation-0 }",
          },
        ],
      }
    `);
  });

  test('create nested list', () => {
    const rq = gql`
      mutation {
        createPost(
          data: {
            title: "test-title"
            comments: {
              create: [{ message: "comment-1" }, { message: "comment-2" }]
            }
          }
        ) {
          id
          title
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);
    expect(transaction).toMatchInlineSnapshot(`
                  Object {
                    "operations": Array [
                      Object {
                        "collectionName": "posts",
                        "data": Object {
                          "comments": Array [
                            Object {
                              "message": "comment-1",
                            },
                            Object {
                              "message": "comment-2",
                            },
                          ],
                          "title": "test-title",
                        },
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                            "title",
                          ],
                        },
                        "identifier": "Operation-0",
                        "kind": "AMCreateOperation",
                        "many": false,
                        "output": "AMResultPromise { Operation-0 }",
                      },
                    ],
                  }
            `);
  });
});

describe('relation', () => {
  const schema = generateSchema(gql`
    type Post @model {
      id: ID @id @unique @db(name: "_id")
      title: String
    }

    type Comment @model {
      id: ID @id @unique @db(name: "_id")
      post: Post @relation
      message: String
      likes: [User!] @relation
    }

    type User @model {
      id: ID @id @unique @db(name: "_id")
      username: String
    }
  `);

  test('select fields', () => {
    const rq = gql`
      {
        comments {
          id
          post {
            id
          }
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);

    expect(transaction).toMatchInlineSnapshot(`
                  Object {
                    "operations": Array [
                      Object {
                        "collectionName": "comments",
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                            "postId",
                          ],
                        },
                        "identifier": "Operation-0",
                        "kind": "AMReadOperation",
                        "many": true,
                        "output": "AMResultPromise { Operation-0 -> distinctReplace('postId', '_id', AMResultPromise { Operation-1 }) }",
                      },
                      Object {
                        "collectionName": "posts",
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                          ],
                        },
                        "identifier": "Operation-1",
                        "kind": "AMReadOperation",
                        "many": true,
                        "output": "AMResultPromise { Operation-1 }",
                        "selector": Object {
                          "_id": Object {
                            "$in": "AMResultPromise { Operation-0 -> distinct('postId') }",
                          },
                        },
                      },
                    ],
                  }
            `);
  });

  test('create', () => {
    const rq = gql`
      mutation {
        createComment(
          data: {
            message: "comment-1"
            post: { connect: { id: "post-id" } }
            likes: { connect: [{ id: "user-1" }, { id: "user-2" }] }
          }
        ) {
          id
          message
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);

    expect(transaction).toMatchInlineSnapshot(`
                  Object {
                    "operations": Array [
                      Object {
                        "collectionName": "comments",
                        "data": Object {
                          "message": "comment-1",
                          "postId": "AMResultPromise { Operation-1 -> path('_id') }",
                          "userIds": "AMResultPromise { Operation-2 -> distinct('_id') }",
                        },
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                            "message",
                          ],
                        },
                        "identifier": "Operation-0",
                        "kind": "AMCreateOperation",
                        "many": false,
                        "output": "AMResultPromise { Operation-0 }",
                      },
                      Object {
                        "collectionName": "posts",
                        "identifier": "Operation-1",
                        "kind": "AMReadOperation",
                        "many": false,
                        "output": "AMResultPromise { Operation-1 }",
                        "selector": Object {
                          "_id": "post-id",
                        },
                      },
                      Object {
                        "collectionName": "users",
                        "identifier": "Operation-2",
                        "kind": "AMReadOperation",
                        "many": true,
                        "output": "AMResultPromise { Operation-2 }",
                        "selector": Object {
                          "$or": Array [
                            Object {
                              "_id": "user-1",
                            },
                            Object {
                              "_id": "user-2",
                            },
                          ],
                        },
                      },
                    ],
                  }
            `);
  });

  test('where relation', () => {
    const rq = gql`
      {
        comments(where: { post: { title: "search-title" } }) {
          id
          message
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);

    expect(transaction).toMatchInlineSnapshot(`
            Object {
              "operations": Array [
                Object {
                  "collectionName": "comments",
                  "fieldsSelection": Object {
                    "fields": Array [
                      "_id",
                      "message",
                    ],
                  },
                  "identifier": "Operation-0",
                  "kind": "AMReadOperation",
                  "many": true,
                  "output": "AMResultPromise { Operation-0 }",
                  "selector": Object {
                    "postId": Object {
                      "$in": "AMResultPromise { Operation-1 -> distinct('_id') }",
                    },
                  },
                },
                Object {
                  "collectionName": "posts",
                  "identifier": "Operation-1",
                  "kind": "AMReadOperation",
                  "many": true,
                  "output": "AMResultPromise { Operation-1 }",
                  "selector": Object {
                    "title": "search-title",
                  },
                },
              ],
            }
        `);
  });
});

describe('extRelation', () => {
  const schema = generateSchema(gql`
    type Post @model {
      id: ID @id @unique @db(name: "_id")
      title: String
      comments: [Comment] @extRelation
    }

    type Comment @model {
      id: ID @id @unique @db(name: "_id")
      post: Post @relation
      message: String
    }
  `);

  test('read', () => {
    const rq = gql`
      {
        posts {
          comments {
            message
          }
        }
      }
    `;

    const transaction = new AMTransaction();
    AMVisitor.visit(schema, rq, {}, transaction);
    expect(transaction).toMatchInlineSnapshot(`
                  Object {
                    "operations": Array [
                      Object {
                        "collectionName": "posts",
                        "fieldsSelection": Object {
                          "fields": Array [
                            "_id",
                          ],
                        },
                        "identifier": "Operation-0",
                        "kind": "AMReadOperation",
                        "many": true,
                        "output": "AMResultPromise { Operation-0 -> lookup('comments', '_id', 'postId', AMResultPromise { Operation-1 }) }",
                      },
                      Object {
                        "collectionName": "comments",
                        "fieldsSelection": Object {
                          "fields": Array [
                            "message",
                          ],
                        },
                        "identifier": "Operation-1",
                        "kind": "AMReadOperation",
                        "many": true,
                        "output": "AMResultPromise { Operation-1 }",
                        "selector": Object {
                          "postId": Object {
                            "$in": "AMResultPromise { Operation-0 -> distinct('_id') }",
                          },
                        },
                      },
                    ],
                  }
            `);
  });
});
