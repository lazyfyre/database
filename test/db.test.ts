/* eslint-env mocha */
import chai from "chai";
const testDb = "workspace/test.db";
import fs from "fs";
import path from "path";
import { apply, each, waterfall } from "./utils.test";
import * as model from "../src/model";
import { Datastore } from "../src/datastore";
import { Persistence } from "../src/persistence";
import { callbackify } from "util";
const reloadTimeUpperBound = 200; // In ms, an upper bound for the reload time used to check createdAt and updatedAt

const { assert } = chai;
chai.should();

describe("Database", function () {
  let d;

  beforeEach(function (done) {
    d = new Datastore({ filename: testDb });
    d.filename.should.equal(testDb);
    d.inMemoryOnly.should.equal(false);

    waterfall(
      [
        function (cb) {
          callbackify((dirname) =>
            Persistence.ensureDirectoryExistsAsync(dirname)
          )(path.dirname(testDb), function () {
            fs.access(testDb, fs.constants.FS_OK, function (err) {
              if (!err) {
                fs.unlink(testDb, cb);
              } else {
                return cb();
              }
            });
          });
        },
        function (cb) {
          d.loadDatabase(function (err) {
            assert.isNull(err);
            d.getAllData().length.should.equal(0);
            return cb();
          });
        },
      ],
      done
    );
  });

  it("Constructor compatibility with v0.6-", function () {
    let dbef = new Datastore("somefile");
    dbef.filename.should.equal("somefile");
    dbef.inMemoryOnly.should.equal(false);

    dbef = new Datastore("");
    assert.isNull(dbef.filename);
    dbef.inMemoryOnly.should.equal(true);

    dbef = new Datastore();
    assert.isNull(dbef.filename);
    dbef.inMemoryOnly.should.equal(true);
  });

  describe("Autoloading", function () {
    it("Can autoload a database and query it right away", function (done) {
      const fileStr =
        model.serialize({ _id: "1", a: 5, planet: "Earth" }) +
        "\n" +
        model.serialize({
          _id: "2",
          a: 5,
          planet: "Mars",
        }) +
        "\n";
      const autoDb = "workspace/auto.db";

      fs.writeFileSync(autoDb, fileStr, "utf8");
      const db = new Datastore({ filename: autoDb, autoload: true });

      db.find({}, function (err, docs) {
        assert.isNull(err);
        docs.length.should.equal(2);
        done();
      });
    });

    it("Throws if autoload fails", function (done) {
      const fileStr =
        model.serialize({ _id: "1", a: 5, planet: "Earth" }) +
        "\n" +
        model.serialize({
          _id: "2",
          a: 5,
          planet: "Mars",
        }) +
        "\n" +
        '{"$$indexCreated":{"fieldName":"a","unique":true}}';
      const autoDb = "workspace/auto.db";

      fs.writeFileSync(autoDb, fileStr, "utf8");

      // Check the loadDatabase generated an error
      function onload(err) {
        err.errorType.should.equal("uniqueViolated");
        done();
      }

      const db = new Datastore({ filename: autoDb, autoload: true, onload });

      // eslint-disable-next-line n/handle-callback-err
      db.find({}, function (err, docs) {
        done(new Error("Find should not be executed since autoload failed"));
      });
    });
  });

  describe("Insert", function () {
    it("Able to insert a document in the database, setting an _id if none provided, and retrieve it even after a reload", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.find({}, function (err, docs) {
        docs.length.should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ somedata: "ok" }, function (err) {
          // The data was correctly updated
          d.find({}, function (err, docs) {
            assert.isNull(err);
            docs.length.should.equal(1);
            Object.keys(docs[0]).length.should.equal(2);
            docs[0].somedata.should.equal("ok");
            assert.isDefined(docs[0]._id);

            // After a reload the data has been correctly persisted
            // eslint-disable-next-line n/handle-callback-err
            d.loadDatabase(function (err) {
              d.find({}, function (err, docs) {
                assert.isNull(err);
                docs.length.should.equal(1);
                Object.keys(docs[0]).length.should.equal(2);
                docs[0].somedata.should.equal("ok");
                assert.isDefined(docs[0]._id);

                done();
              });
            });
          });
        });
      });
    });

    it("Can insert multiple documents in the database", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.find({}, function (err, docs) {
        docs.length.should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ somedata: "ok" }, function (err) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ somedata: "another" }, function (err) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "again" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                docs.length.should.equal(3);
                docs.map((x) => x.somedata).should.contain("ok");
                docs.map((x) => x.somedata).should.contain("another");
                docs.map((x) => x.somedata).should.contain("again");
                done();
              });
            });
          });
        });
      });
    });

    it("Can insert and get back from DB complex objects with all primitive and secondary types", function (done) {
      const da = new Date();
      const obj = { a: ["ee", "ff", 42], date: da, subobj: { a: "b", b: "c" } };

      // eslint-disable-next-line n/handle-callback-err
      d.insert(obj, function (err) {
        d.findOne({}, function (err, res) {
          assert.isNull(err);
          res.a.length.should.equal(3);
          res.a[0].should.equal("ee");
          res.a[1].should.equal("ff");
          res.a[2].should.equal(42);
          res.date.getTime().should.equal(da.getTime());
          res.subobj.a.should.equal("b");
          res.subobj.b.should.equal("c");

          done();
        });
      });
    });

    it("If an object returned from the DB is modified and refetched, the original value should be found", function (done) {
      d.insert({ a: "something" }, function () {
        // eslint-disable-next-line n/handle-callback-err
        d.findOne({}, function (err, doc) {
          doc.a.should.equal("something");
          doc.a = "another thing";
          doc.a.should.equal("another thing");

          // Re-fetching with findOne should yield the persisted value
          // eslint-disable-next-line n/handle-callback-err
          d.findOne({}, function (err, doc) {
            doc.a.should.equal("something");
            doc.a = "another thing";
            doc.a.should.equal("another thing");

            // Re-fetching with find should yield the persisted value
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs[0].a.should.equal("something");

              done();
            });
          });
        });
      });
    });

    it("Cannot insert a doc that has a field beginning with a $ sign", function (done) {
      d.insert({ $something: "atest" }, function (err) {
        assert.isDefined(err);
        done();
      });
    });

    it("If an _id is already given when we insert a document, use that instead of generating a random one", function (done) {
      d.insert({ _id: "test", stuff: true }, function (err, newDoc) {
        if (err) {
          return done(err);
        }

        newDoc.stuff.should.equal(true);
        newDoc._id.should.equal("test");

        d.insert({ _id: "test", otherstuff: 42 }, function (err) {
          err.errorType.should.equal("uniqueViolated");

          done();
        });
      });
    });

    it("Modifying the insertedDoc after an insert doesnt change the copy saved in the database", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 2, hello: "world" }, function (err, newDoc) {
        newDoc.hello = "changed";

        // eslint-disable-next-line n/handle-callback-err
        d.findOne({ a: 2 }, function (err, doc) {
          doc.hello.should.equal("world");
          done();
        });
      });
    });

    it("Can insert an array of documents at once", function (done) {
      const docs = [
        { a: 5, b: "hello" },
        { a: 42, b: "world" },
      ];

      // eslint-disable-next-line n/handle-callback-err
      d.insert(docs, function (err) {
        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          docs.length.should.equal(2);
          docs
            .find(function (doc) {
              return doc.a === 5;
            })
            .b.should.equal("hello");
          docs
            .find(function (doc) {
              return doc.a === 42;
            })
            .b.should.equal("world");

          // The data has been persisted correctly
          const data = fs
            .readFileSync(testDb, "utf8")
            .split("\n")
            .filter(function (line) {
              return line.length > 0;
            });
          data.length.should.equal(2);
          model.deserialize(data[0]).a.should.equal(5);
          model.deserialize(data[0]).b.should.equal("hello");
          model.deserialize(data[1]).a.should.equal(42);
          model.deserialize(data[1]).b.should.equal("world");

          done();
        });
      });
    });

    it("If a bulk insert violates a constraint, all changes are rolled back", function (done) {
      const docs = [
        { a: 5, b: "hello" },
        { a: 42, b: "world" },
        { a: 5, b: "bloup" },
        { a: 7 },
      ];

      d.ensureIndex({ fieldName: "a", unique: true }, function () {
        // Important to specify callback here to make sure filesystem synced
        d.insert(docs, function (err) {
          err.errorType.should.equal("uniqueViolated");

          // eslint-disable-next-line n/handle-callback-err
          d.find({}, function (err, docs) {
            // Datafile only contains index definition
            const datafileContents = model.deserialize(
              fs.readFileSync(testDb, "utf8")
            );
            assert.deepStrictEqual(datafileContents, {
              $$indexCreated: { fieldName: "a", unique: true },
            });

            docs.length.should.equal(0);

            done();
          });
        });
      });
    });

    it("If timestampData option is set, a createdAt field is added and persisted", function (done) {
      const newDoc = { hello: "world" };
      const beginning = Date.now();
      d = new Datastore({
        filename: testDb,
        timestampData: true,
        autoload: true,
      });
      d.find({}, function (err, docs) {
        assert.isNull(err);
        docs.length.should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert(newDoc, function (err, insertedDoc) {
          // No side effect on given input
          assert.deepStrictEqual(newDoc, { hello: "world" });
          // Insert doc has two new fields, _id and createdAt
          insertedDoc.hello.should.equal("world");
          assert.isDefined(insertedDoc.createdAt);
          assert.isDefined(insertedDoc.updatedAt);
          insertedDoc.createdAt.should.equal(insertedDoc.updatedAt);
          assert.isDefined(insertedDoc._id);
          Object.keys(insertedDoc).length.should.equal(4);
          assert.isBelow(
            Math.abs(insertedDoc.createdAt.getTime() - beginning),
            reloadTimeUpperBound
          ); // No more than 30ms should have elapsed (worst case, if there is a flush)

          // Modifying results of insert doesn't change the cache
          insertedDoc.bloup = "another";
          Object.keys(insertedDoc).length.should.equal(5);

          // eslint-disable-next-line n/handle-callback-err
          d.find({}, function (err, docs) {
            docs.length.should.equal(1);
            assert.deepStrictEqual(newDoc, { hello: "world" });
            assert.deepStrictEqual(
              {
                hello: "world",
                _id: insertedDoc._id,
                createdAt: insertedDoc.createdAt,
                updatedAt: insertedDoc.updatedAt,
              },
              docs[0]
            );

            // All data correctly persisted on disk
            d.loadDatabase(function () {
              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                docs.length.should.equal(1);
                assert.deepStrictEqual(newDoc, { hello: "world" });
                assert.deepStrictEqual(
                  {
                    hello: "world",
                    _id: insertedDoc._id,
                    createdAt: insertedDoc.createdAt,
                    updatedAt: insertedDoc.updatedAt,
                  },
                  docs[0]
                );

                done();
              });
            });
          });
        });
      });
    });

    it("If timestampData option not set, don't create a createdAt and a updatedAt field", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ hello: "world" }, function (err, insertedDoc) {
        Object.keys(insertedDoc).length.should.equal(2);
        assert.isUndefined(insertedDoc.createdAt);
        assert.isUndefined(insertedDoc.updatedAt);

        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          docs.length.should.equal(1);
          assert.deepStrictEqual(docs[0], insertedDoc);

          done();
        });
      });
    });

    it("If timestampData is set but createdAt is specified by user, don't change it", function (done) {
      const newDoc = { hello: "world", createdAt: new Date(234) };
      const beginning = Date.now();
      d = new Datastore({
        filename: testDb,
        timestampData: true,
        autoload: true,
      });
      // eslint-disable-next-line n/handle-callback-err
      d.insert(newDoc, function (err, insertedDoc) {
        Object.keys(insertedDoc).length.should.equal(4);
        insertedDoc.createdAt.getTime().should.equal(234); // Not modified
        assert.isBelow(
          insertedDoc.updatedAt.getTime() - beginning,
          reloadTimeUpperBound
        ); // Created

        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          assert.deepStrictEqual(insertedDoc, docs[0]);

          d.loadDatabase(function () {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              assert.deepStrictEqual(insertedDoc, docs[0]);

              done();
            });
          });
        });
      });
    });

    it("If timestampData is set but updatedAt is specified by user, don't change it", function (done) {
      const newDoc = { hello: "world", updatedAt: new Date(234) };
      const beginning = Date.now();
      d = new Datastore({
        filename: testDb,
        timestampData: true,
        autoload: true,
      });
      // eslint-disable-next-line n/handle-callback-err
      d.insert(newDoc, function (err, insertedDoc) {
        Object.keys(insertedDoc).length.should.equal(4);
        insertedDoc.updatedAt.getTime().should.equal(234); // Not modified
        assert.isBelow(
          insertedDoc.createdAt.getTime() - beginning,
          reloadTimeUpperBound
        ); // Created

        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          assert.deepStrictEqual(insertedDoc, docs[0]);

          d.loadDatabase(function () {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              assert.deepStrictEqual(insertedDoc, docs[0]);

              done();
            });
          });
        });
      });
    });

    it("Can insert a doc with id 0", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ _id: 0, hello: "world" }, function (err, doc) {
        doc._id.should.equal(0);
        doc.hello.should.equal("world");
        done();
      });
    });

    /**
     * Complicated behavior here. Basically we need to test that when a user function throws an exception, it is not caught
     * in NeDB and the callback called again, transforming a user error into a NeDB error.
     *
     * So we need a way to check that the callback is called only once and the exception thrown is indeed the client exception
     * Mocha's exception handling mechanism interferes with this since it already registers a listener on uncaughtException
     * which we need to use since findOne is not called in the same turn of the event loop (so no try/catch)
     * So we remove all current listeners, put our own which when called will register the former listeners (incl. Mocha's) again.
     *
     * Note: maybe using an in-memory only NeDB would give us an easier solution
     */
    it("If the callback throws an uncaught exception, do not catch it inside findOne, this is userspace concern", function (done) {
      let tryCount = 0;
      const currentUncaughtExceptionHandlers =
        process.listeners("uncaughtException");

      let i;

      process.removeAllListeners("uncaughtException");

      process.on("uncaughtException", function MINE(ex) {
        process.removeAllListeners("uncaughtException");

        for (i = 0; i < currentUncaughtExceptionHandlers.length; i += 1) {
          process.on("uncaughtException", currentUncaughtExceptionHandlers[i]);
        }

        ex.message.should.equal("SOME EXCEPTION");
        done();
      });

      d.insert({ a: 5 }, function () {
        // eslint-disable-next-line n/handle-callback-err
        d.findOne({ a: 5 }, function (err, doc) {
          if (tryCount === 0) {
            tryCount += 1;
            throw new Error("SOME EXCEPTION");
          } else {
            done(new Error("Callback was called twice"));
          }
        });
      });
    });
  }); // ==== End of 'Insert' ==== //

  describe("#getCandidates", function () {
    it("Can use an index to get docs with a basic match", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.ensureIndex({ fieldName: "tf" }, function (err) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ tf: 4 }, function (err, _doc1) {
          d.insert({ tf: 6 }, function () {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ tf: 4, an: "other" }, function (err, _doc2) {
              d.insert({ tf: 9 }, function () {
                // eslint-disable-next-line n/handle-callback-err
                callbackify((query) => d._getCandidatesAsync(query))(
                  { r: 6, tf: 4 },
                  function (err, data) {
                    const doc1 = data.find(function (d) {
                      return d._id === _doc1._id;
                    });
                    const doc2 = data.find(function (d) {
                      return d._id === _doc2._id;
                    });

                    data.length.should.equal(2);
                    assert.deepStrictEqual(doc1, { _id: doc1._id, tf: 4 });
                    assert.deepStrictEqual(doc2, {
                      _id: doc2._id,
                      tf: 4,
                      an: "other",
                    });

                    done();
                  }
                );
              });
            });
          });
        });
      });
    });

    it("Can use a compound index to get docs with a basic match", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.ensureIndex({ fieldName: ["tf", "tg"] }, function (err) {
        d.insert({ tf: 4, tg: 0, foo: 1 }, function () {
          d.insert({ tf: 6, tg: 0, foo: 2 }, function () {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ tf: 4, tg: 1, foo: 3 }, function (err, _doc1) {
              d.insert({ tf: 6, tg: 1, foo: 4 }, function () {
                // eslint-disable-next-line n/handle-callback-err
                callbackify((query) => d._getCandidatesAsync(query))(
                  { tf: 4, tg: 1 },
                  function (err, data) {
                    const doc1 = data.find(function (d) {
                      return d._id === _doc1._id;
                    });

                    data.length.should.equal(1);
                    assert.deepEqual(doc1, {
                      _id: doc1._id,
                      tf: 4,
                      tg: 1,
                      foo: 3,
                    });

                    done();
                  }
                );
              });
            });
          });
        });
      });
    });

    it("Can use an index to get docs with a $in match", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.ensureIndex({ fieldName: "tf" }, function (err) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ tf: 4 }, function (err) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ tf: 6 }, function (err, _doc1) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ tf: 4, an: "other" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert({ tf: 9 }, function (err, _doc2) {
                // eslint-disable-next-line n/handle-callback-err
                callbackify((query) => d._getCandidatesAsync(query))(
                  { r: 6, tf: { $in: [6, 9, 5] } },
                  function (err, data) {
                    const doc1 = data.find(function (d) {
                      return d._id === _doc1._id;
                    });
                    const doc2 = data.find(function (d) {
                      return d._id === _doc2._id;
                    });

                    data.length.should.equal(2);
                    assert.deepStrictEqual(doc1, { _id: doc1._id, tf: 6 });
                    assert.deepStrictEqual(doc2, { _id: doc2._id, tf: 9 });

                    done();
                  }
                );
              });
            });
          });
        });
      });
    });

    it("If no index can be used, return the whole database", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.ensureIndex({ fieldName: "tf" }, function (err) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ tf: 4 }, function (err, _doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ tf: 6 }, function (err, _doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ tf: 4, an: "other" }, function (err, _doc3) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert({ tf: 9 }, function (err, _doc4) {
                // eslint-disable-next-line n/handle-callback-err
                callbackify((query) => d._getCandidatesAsync(query))(
                  { r: 6, notf: { $in: [6, 9, 5] } },
                  function (err, data) {
                    const doc1 = data.find(function (d) {
                      return d._id === _doc1._id;
                    });
                    const doc2 = data.find(function (d) {
                      return d._id === _doc2._id;
                    });
                    const doc3 = data.find(function (d) {
                      return d._id === _doc3._id;
                    });
                    const doc4 = data.find(function (d) {
                      return d._id === _doc4._id;
                    });

                    data.length.should.equal(4);
                    assert.deepStrictEqual(doc1, { _id: doc1._id, tf: 4 });
                    assert.deepStrictEqual(doc2, { _id: doc2._id, tf: 6 });
                    assert.deepStrictEqual(doc3, {
                      _id: doc3._id,
                      tf: 4,
                      an: "other",
                    });
                    assert.deepStrictEqual(doc4, { _id: doc4._id, tf: 9 });

                    done();
                  }
                );
              });
            });
          });
        });
      });
    });

    it("Can use indexes for comparison matches", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.ensureIndex({ fieldName: "tf" }, function (err) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ tf: 4 }, function (err, _doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ tf: 6 }, function (err, _doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ tf: 4, an: "other" }, function (err, _doc3) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert({ tf: 9 }, function (err, _doc4) {
                // eslint-disable-next-line n/handle-callback-err
                callbackify((query) => d._getCandidatesAsync(query))(
                  { r: 6, tf: { $lte: 9, $gte: 6 } },
                  function (err, data) {
                    const doc2 = data.find(function (d) {
                      return d._id === _doc2._id;
                    });
                    const doc4 = data.find(function (d) {
                      return d._id === _doc4._id;
                    });

                    data.length.should.equal(2);
                    assert.deepStrictEqual(doc2, { _id: doc2._id, tf: 6 });
                    assert.deepStrictEqual(doc4, { _id: doc4._id, tf: 9 });

                    done();
                  }
                );
              });
            });
          });
        });
      });
    });

    it("Can set a TTL index that expires documents", function (done) {
      d.ensureIndex({ fieldName: "exp", expireAfterSeconds: 0.2 }, function () {
        d.insert({ hello: "world", exp: new Date() }, function () {
          setTimeout(function () {
            d.findOne({}, function (err, doc) {
              assert.isNull(err);
              doc.hello.should.equal("world");

              setTimeout(function () {
                d.findOne({}, function (err, doc) {
                  assert.isNull(err);
                  assert.isNull(doc);

                  d.on("compaction.done", function () {
                    // After compaction, no more mention of the document, correctly removed
                    const datafileContents = fs.readFileSync(testDb, "utf8");
                    datafileContents.split("\n").length.should.equal(2);
                    assert.isNull(datafileContents.match(/world/));

                    // New datastore on same datafile is empty
                    const d2 = new Datastore({
                      filename: testDb,
                      autoload: true,
                    });
                    d2.findOne({}, function (err, doc) {
                      assert.isNull(err);
                      assert.isNull(doc);

                      done();
                    });
                  });

                  d.compactDatafile();
                });
              }, 101);
            });
          }, 100);
        });
      });
    });

    it("TTL indexes can expire multiple documents and only what needs to be expired", function (done) {
      d.ensureIndex({ fieldName: "exp", expireAfterSeconds: 0.2 }, function () {
        d.insert({ hello: "world1", exp: new Date() }, function () {
          d.insert({ hello: "world2", exp: new Date() }, function () {
            d.insert(
              { hello: "world3", exp: new Date(new Date().getTime() + 100) },
              function () {
                setTimeout(function () {
                  d.find({}, function (err, docs) {
                    assert.isNull(err);
                    docs.length.should.equal(3);

                    setTimeout(function () {
                      d.find({}, function (err, docs) {
                        assert.isNull(err);
                        docs.length.should.equal(1);
                        docs[0].hello.should.equal("world3");

                        setTimeout(function () {
                          d.find({}, function (err, docs) {
                            assert.isNull(err);
                            docs.length.should.equal(0);

                            done();
                          });
                        }, 101);
                      });
                    }, 101);
                  });
                }, 100);
              }
            );
          });
        });
      });
    });

    it("Document where indexed field is absent or not a date are ignored", function (done) {
      d.ensureIndex({ fieldName: "exp", expireAfterSeconds: 0.2 }, function () {
        d.insert({ hello: "world1", exp: new Date() }, function () {
          d.insert({ hello: "world2", exp: "not a date" }, function () {
            d.insert({ hello: "world3" }, function () {
              setTimeout(function () {
                d.find({}, function (err, docs) {
                  assert.isNull(err);
                  docs.length.should.equal(3);

                  setTimeout(function () {
                    d.find({}, function (err, docs) {
                      assert.isNull(err);
                      docs.length.should.equal(2);

                      docs[0].hello.should.not.equal("world1");
                      docs[1].hello.should.not.equal("world1");

                      done();
                    });
                  }, 101);
                });
              }, 100);
            });
          });
        });
      });
    });
  }); // ==== End of '#getCandidates' ==== //

  describe("Find", function () {
    it("Can find all documents if an empty query is used", function (done) {
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "another", plus: "additional data" },
                function (err) {
                  d.insert({ somedata: "again" }, function (err) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with empty object
            d.find({}, function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(3);
              docs.map((x) => x.somedata).should.contain("ok");
              docs.map((x) => x.somedata).should.contain("another");
              docs
                .find(function (d) {
                  return d.somedata === "another";
                })
                .plus.should.equal("additional data");
              docs.map((x) => x.somedata).should.contain("again");
              return cb();
            });
          },
        ],
        done
      );
    });

    it("Can find all documents matching a basic query", function (done) {
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err) {
                  d.insert({ somedata: "again" }, function (err) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with query that will return docs
            d.find({ somedata: "again" }, function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(2);
              docs.map((x) => x.somedata).should.not.contain("ok");
              return cb();
            });
          },
          function (cb) {
            // Test with query that doesn't match anything
            d.find({ somedata: "nope" }, function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(0);
              return cb();
            });
          },
        ],
        done
      );
    });

    it("Can find one document matching a basic query and return null if none is found", function (done) {
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err) {
                  d.insert({ somedata: "again" }, function (err) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with query that will return docs
            d.findOne({ somedata: "ok" }, function (err, doc) {
              assert.isNull(err);
              Object.keys(doc).length.should.equal(2);
              doc.somedata.should.equal("ok");
              assert.isDefined(doc._id);
              return cb();
            });
          },
          function (cb) {
            // Test with query that doesn't match anything
            d.findOne({ somedata: "nope" }, function (err, doc) {
              assert.isNull(err);
              assert.isNull(doc);
              return cb();
            });
          },
        ],
        done
      );
    });

    it("Can find dates and objects (non JS-native types)", function (done) {
      const date1 = new Date(1234543);
      const date2 = new Date(9999);

      d.insert({ now: date1, sth: { name: "nedb" } }, function () {
        d.findOne({ now: date1 }, function (err, doc) {
          assert.isNull(err);
          doc.sth.name.should.equal("nedb");

          d.findOne({ now: date2 }, function (err, doc) {
            assert.isNull(err);
            assert.isNull(doc);

            d.findOne({ sth: { name: "nedb" } }, function (err, doc) {
              assert.isNull(err);
              doc.sth.name.should.equal("nedb");

              d.findOne({ sth: { name: "other" } }, function (err, doc) {
                assert.isNull(err);
                assert.isNull(doc);

                done();
              });
            });
          });
        });
      });
    });

    it("Can use dot-notation to query subfields", function (done) {
      d.insert({ greeting: { english: "hello" } }, function () {
        d.findOne({ "greeting.english": "hello" }, function (err, doc) {
          assert.isNull(err);
          doc.greeting.english.should.equal("hello");

          d.findOne({ "greeting.english": "hellooo" }, function (err, doc) {
            assert.isNull(err);
            assert.isNull(doc);

            d.findOne({ "greeting.englis": "hello" }, function (err, doc) {
              assert.isNull(err);
              assert.isNull(doc);

              done();
            });
          });
        });
      });
    });

    it("Array fields match if any element matches", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ fruits: ["pear", "apple", "banana"] }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert(
          { fruits: ["coconut", "orange", "pear"] },
          function (err, doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ fruits: ["banana"] }, function (err, doc3) {
              d.find({ fruits: "pear" }, function (err, docs) {
                assert.isNull(err);
                docs.length.should.equal(2);
                docs.map((x) => x._id).should.contain(doc1._id);
                docs.map((x) => x._id).should.contain(doc2._id);

                d.find({ fruits: "banana" }, function (err, docs) {
                  assert.isNull(err);
                  docs.length.should.equal(2);
                  docs.map((x) => x._id).should.contain(doc1._id);
                  docs.map((x) => x._id).should.contain(doc3._id);

                  d.find({ fruits: "doesntexist" }, function (err, docs) {
                    assert.isNull(err);
                    docs.length.should.equal(0);

                    done();
                  });
                });
              });
            });
          }
        );
      });
    });

    it("Returns an error if the query is not well formed", function (done) {
      d.insert({ hello: "world" }, function () {
        d.find({ $or: { hello: "world" } }, function (err, docs) {
          assert.isDefined(err);
          assert.isUndefined(docs);

          d.findOne({ $or: { hello: "world" } }, function (err, doc) {
            assert.isDefined(err);
            assert.isUndefined(doc);

            done();
          });
        });
      });
    });

    it("Changing the documents returned by find or findOne do not change the database state", function (done) {
      d.insert({ a: 2, hello: "world" }, function () {
        // eslint-disable-next-line n/handle-callback-err
        d.findOne({ a: 2 }, function (err, doc) {
          doc.hello = "changed";

          // eslint-disable-next-line n/handle-callback-err
          d.findOne({ a: 2 }, function (err, doc) {
            doc.hello.should.equal("world");

            // eslint-disable-next-line n/handle-callback-err
            d.find({ a: 2 }, function (err, docs) {
              docs[0].hello = "changed";

              // eslint-disable-next-line n/handle-callback-err
              d.findOne({ a: 2 }, function (err, doc) {
                doc.hello.should.equal("world");

                done();
              });
            });
          });
        });
      });
    });

    it("Can use sort, skip and limit if the callback is not passed to find but to exec", function (done) {
      d.insert({ a: 2, hello: "world" }, function () {
        d.insert({ a: 24, hello: "earth" }, function () {
          d.insert({ a: 13, hello: "blueplanet" }, function () {
            d.insert({ a: 15, hello: "home" }, function () {
              d.find({})
                .sort({ a: 1 })
                .limit(2)
                .exec(function (err, docs) {
                  assert.isNull(err);
                  docs.length.should.equal(2);
                  docs[0].hello.should.equal("world");
                  docs[1].hello.should.equal("blueplanet");
                  done();
                });
            });
          });
        });
      });
    });

    it("Can use sort and skip if the callback is not passed to findOne but to exec", function (done) {
      d.insert({ a: 2, hello: "world" }, function () {
        d.insert({ a: 24, hello: "earth" }, function () {
          d.insert({ a: 13, hello: "blueplanet" }, function () {
            d.insert({ a: 15, hello: "home" }, function () {
              // No skip no query
              d.findOne({})
                .sort({ a: 1 })
                .exec(function (err, doc) {
                  assert.isNull(err);
                  doc.hello.should.equal("world");

                  // A query
                  d.findOne({ a: { $gt: 14 } })
                    .sort({ a: 1 })
                    .exec(function (err, doc) {
                      assert.isNull(err);
                      doc.hello.should.equal("home");

                      // And a skip
                      d.findOne({ a: { $gt: 14 } })
                        .sort({ a: 1 })
                        .skip(1)
                        .exec(function (err, doc) {
                          assert.isNull(err);
                          doc.hello.should.equal("earth");

                          // No result
                          d.findOne({ a: { $gt: 14 } })
                            .sort({ a: 1 })
                            .skip(2)
                            .exec(function (err, doc) {
                              assert.isNull(err);
                              assert.isNull(doc);

                              done();
                            });
                        });
                    });
                });
            });
          });
        });
      });
    });

    it("Can use projections in find, normal or cursor way", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 2, hello: "world" }, function (err, doc0) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 24, hello: "earth" }, function (err, doc1) {
          d.find({ a: 2 }, { a: 0, _id: 0 }, function (err, docs) {
            assert.isNull(err);
            docs.length.should.equal(1);
            assert.deepStrictEqual(docs[0], { hello: "world" });

            d.find({ a: 2 }, { a: 0, _id: 0 }).exec(function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(1);
              assert.deepStrictEqual(docs[0], { hello: "world" });

              // Can't use both modes at once if not _id
              d.find({ a: 2 }, { a: 0, hello: 1 }, function (err, docs) {
                assert.isNotNull(err);
                assert.isUndefined(docs);

                d.find({ a: 2 }, { a: 0, hello: 1 }).exec(function (err, docs) {
                  assert.isNotNull(err);
                  assert.isUndefined(docs);

                  done();
                });
              });
            });
          });
        });
      });
    });

    it("Can use projections in findOne, normal or cursor way", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 2, hello: "world" }, function (err, doc0) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 24, hello: "earth" }, function (err, doc1) {
          d.findOne({ a: 2 }, { a: 0, _id: 0 }, function (err, doc) {
            assert.isNull(err);
            assert.deepStrictEqual(doc, { hello: "world" });

            d.findOne({ a: 2 }, { a: 0, _id: 0 }).exec(function (err, doc) {
              assert.isNull(err);
              assert.deepStrictEqual(doc, { hello: "world" });

              // Can't use both modes at once if not _id
              d.findOne({ a: 2 }, { a: 0, hello: 1 }, function (err, doc) {
                assert.isNotNull(err);
                assert.isUndefined(doc);

                d.findOne({ a: 2 }, { a: 0, hello: 1 }).exec(function (
                  err,
                  doc
                ) {
                  assert.isNotNull(err);
                  assert.isUndefined(doc);

                  done();
                });
              });
            });
          });
        });
      });
    });
  }); // ==== End of 'Find' ==== //

  describe("Count", function () {
    it("Count all documents if an empty query is used", function (done) {
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "another", plus: "additional data" },
                function (err) {
                  d.insert({ somedata: "again" }, function (err) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with empty object
            d.count({}, function (err, docs) {
              assert.isNull(err);
              docs.should.equal(3);
              return cb();
            });
          },
        ],
        done
      );
    });

    it("Count all documents matching a basic query", function (done) {
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err) {
                  d.insert({ somedata: "again" }, function (err) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with query that will return docs
            d.count({ somedata: "again" }, function (err, docs) {
              assert.isNull(err);
              docs.should.equal(2);
              return cb();
            });
          },
          function (cb) {
            // Test with query that doesn't match anything
            d.count({ somedata: "nope" }, function (err, docs) {
              assert.isNull(err);
              docs.should.equal(0);
              return cb();
            });
          },
        ],
        done
      );
    });

    it("Array fields match if any element matches", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ fruits: ["pear", "apple", "banana"] }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert(
          { fruits: ["coconut", "orange", "pear"] },
          function (err, doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ fruits: ["banana"] }, function (err, doc3) {
              d.count({ fruits: "pear" }, function (err, docs) {
                assert.isNull(err);
                docs.should.equal(2);

                d.count({ fruits: "banana" }, function (err, docs) {
                  assert.isNull(err);
                  docs.should.equal(2);

                  d.count({ fruits: "doesntexist" }, function (err, docs) {
                    assert.isNull(err);
                    docs.should.equal(0);

                    done();
                  });
                });
              });
            });
          }
        );
      });
    });

    it("Returns an error if the query is not well formed", function (done) {
      d.insert({ hello: "world" }, function () {
        d.count({ $or: { hello: "world" } }, function (err, docs) {
          assert.isDefined(err);
          assert.isUndefined(docs);

          done();
        });
      });
    });
  });

  describe("Update", function () {
    it("If the query doesn't match anything, database is not modified", function (done) {
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err) {
                  d.insert({ somedata: "another" }, function (err) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with query that doesn't match anything
            d.update(
              { somedata: "nope" },
              { newDoc: "yes" },
              { multi: true },
              function (err, n) {
                assert.isNull(err);
                n.should.equal(0);

                // eslint-disable-next-line n/handle-callback-err
                d.find({}, function (err, docs) {
                  const doc1 = docs.find(function (d) {
                    return d.somedata === "ok";
                  });
                  const doc2 = docs.find(function (d) {
                    return d.somedata === "again";
                  });
                  const doc3 = docs.find(function (d) {
                    return d.somedata === "another";
                  });

                  docs.length.should.equal(3);
                  assert.isUndefined(
                    docs.find(function (d) {
                      return d.newDoc === "yes";
                    })
                  );

                  assert.deepStrictEqual(doc1, {
                    _id: doc1._id,
                    somedata: "ok",
                  });
                  assert.deepStrictEqual(doc2, {
                    _id: doc2._id,
                    somedata: "again",
                    plus: "additional data",
                  });
                  assert.deepStrictEqual(doc3, {
                    _id: doc3._id,
                    somedata: "another",
                  });

                  return cb();
                });
              }
            );
          },
        ],
        done
      );
    });

    it("If timestampData option is set, update the updatedAt field", function (done) {
      const beginning = Date.now();
      d = new Datastore({
        filename: testDb,
        autoload: true,
        timestampData: true,
      });
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ hello: "world" }, function (err, insertedDoc) {
        assert.isBelow(
          insertedDoc.updatedAt.getTime() - beginning,
          reloadTimeUpperBound
        );
        assert.isBelow(
          insertedDoc.createdAt.getTime() - beginning,
          reloadTimeUpperBound
        );
        Object.keys(insertedDoc).length.should.equal(4);

        // Wait 100ms before performing the update
        setTimeout(function () {
          const step1 = Date.now();
          d.update(
            { _id: insertedDoc._id },
            { $set: { hello: "mars" } },
            {},
            function () {
              // eslint-disable-next-line n/handle-callback-err
              d.find({ _id: insertedDoc._id }, function (err, docs) {
                docs.length.should.equal(1);
                Object.keys(docs[0]).length.should.equal(4);
                docs[0]._id.should.equal(insertedDoc._id);
                docs[0].createdAt.should.equal(insertedDoc.createdAt);
                docs[0].hello.should.equal("mars");
                assert.isAbove(docs[0].updatedAt.getTime() - beginning, 99); // updatedAt modified
                assert.isBelow(
                  docs[0].updatedAt.getTime() - step1,
                  reloadTimeUpperBound
                ); // updatedAt modified

                done();
              });
            }
          );
        }, 100);
      });
    });

    it("Can update multiple documents matching the query", function (done) {
      let id1;
      let id2;
      let id3;

      // Test DB state after update and reload
      function testPostUpdateState(cb) {
        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          const doc1 = docs.find(function (d) {
            return d._id === id1;
          });
          const doc2 = docs.find(function (d) {
            return d._id === id2;
          });
          const doc3 = docs.find(function (d) {
            return d._id === id3;
          });

          docs.length.should.equal(3);

          Object.keys(doc1).length.should.equal(2);
          doc1.somedata.should.equal("ok");
          doc1._id.should.equal(id1);

          Object.keys(doc2).length.should.equal(2);
          doc2.newDoc.should.equal("yes");
          doc2._id.should.equal(id2);

          Object.keys(doc3).length.should.equal(2);
          doc3.newDoc.should.equal("yes");
          doc3._id.should.equal(id3);

          return cb();
        });
      }

      // Actually launch the tests
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err, doc1) {
              id1 = doc1._id;
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err, doc2) {
                  id2 = doc2._id;
                  d.insert({ somedata: "again" }, function (err, doc3) {
                    id3 = doc3._id;
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            d.update(
              { somedata: "again" },
              { newDoc: "yes" },
              { multi: true },
              function (err, n) {
                assert.isNull(err);
                n.should.equal(2);
                return cb();
              }
            );
          },
          apply(testPostUpdateState),
          function (cb) {
            d.loadDatabase(function (err) {
              cb(err);
            });
          },
          apply(testPostUpdateState),
        ],
        done
      );
    });

    it("Can update only one document matching the query", function (done) {
      let id1;
      let id2;
      let id3;

      // Test DB state after update and reload
      function testPostUpdateState(cb) {
        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          const doc1 = docs.find(function (d) {
            return d._id === id1;
          });
          const doc2 = docs.find(function (d) {
            return d._id === id2;
          });
          const doc3 = docs.find(function (d) {
            return d._id === id3;
          });

          docs.length.should.equal(3);

          assert.deepStrictEqual(doc1, { somedata: "ok", _id: doc1._id });

          // doc2 or doc3 was modified. Since we sort on _id and it is random
          // it can be either of two situations
          try {
            assert.deepStrictEqual(doc2, { newDoc: "yes", _id: doc2._id });
            assert.deepStrictEqual(doc3, { somedata: "again", _id: doc3._id });
          } catch (e) {
            assert.deepStrictEqual(doc2, {
              somedata: "again",
              plus: "additional data",
              _id: doc2._id,
            });
            assert.deepStrictEqual(doc3, { newDoc: "yes", _id: doc3._id });
          }

          return cb();
        });
      }

      // Actually launch the test
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err, doc1) {
              id1 = doc1._id;
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err, doc2) {
                  id2 = doc2._id;
                  d.insert({ somedata: "again" }, function (err, doc3) {
                    id3 = doc3._id;
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with query that doesn't match anything
            d.update(
              { somedata: "again" },
              { newDoc: "yes" },
              { multi: false },
              function (err, n) {
                assert.isNull(err);
                n.should.equal(1);
                return cb();
              }
            );
          },
          apply(testPostUpdateState),
          function (cb) {
            d.loadDatabase(function (err) {
              return cb(err);
            });
          },
          apply(testPostUpdateState), // The persisted state has been updated
        ],
        done
      );
    });

    describe("Upserts", function () {
      it("Can perform upserts if needed", function (done) {
        d.update(
          { impossible: "db is empty anyway" },
          { newDoc: true },
          {},
          function (err, nr, affectedDocuments) {
            assert.isNull(err);
            nr.should.equal(0);
            assert.isNull(affectedDocuments);

            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(0); // Default option for upsert is false

              d.update(
                { impossible: "db is empty anyway" },
                { something: "created ok" },
                { upsert: true },
                function (err, nr, newDoc) {
                  assert.isNull(err);
                  nr.should.equal(1);
                  newDoc.something.should.equal("created ok");
                  assert.isDefined(newDoc._id);

                  // eslint-disable-next-line n/handle-callback-err
                  d.find({}, function (err, docs) {
                    docs.length.should.equal(1); // Default option for upsert is false
                    docs[0].something.should.equal("created ok");

                    // Modifying the returned upserted document doesn't modify the database
                    newDoc.newField = true;
                    // eslint-disable-next-line n/handle-callback-err
                    d.find({}, function (err, docs) {
                      docs[0].something.should.equal("created ok");
                      assert.isUndefined(docs[0].newField);

                      done();
                    });
                  });
                }
              );
            });
          }
        );
      });

      it("If the update query is a normal object with no modifiers, it is the doc that will be upserted", function (done) {
        // eslint-disable-next-line n/handle-callback-err
        d.update(
          { $or: [{ a: 4 }, { a: 5 }] },
          { hello: "world", bloup: "blap" },
          { upsert: true },
          function (err) {
            d.find({}, function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(1);
              const doc = docs[0];
              Object.keys(doc).length.should.equal(3);
              doc.hello.should.equal("world");
              doc.bloup.should.equal("blap");
              done();
            });
          }
        );
      });

      it("If the update query contains modifiers, it is applied to the object resulting from removing all operators from the find query 1", function (done) {
        d.update(
          { $or: [{ a: 4 }, { a: 5 }] },
          {
            $set: { hello: "world" },
            $inc: { bloup: 3 },
            // eslint-disable-next-line n/handle-callback-err
          },
          { upsert: true },
          function (err) {
            d.find({ hello: "world" }, function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(1);
              const doc = docs[0];
              Object.keys(doc).length.should.equal(3);
              doc.hello.should.equal("world");
              doc.bloup.should.equal(3);
              done();
            });
          }
        );
      });

      it("If the update query contains modifiers, it is applied to the object resulting from removing all operators from the find query 2", function (done) {
        d.update(
          { $or: [{ a: 4 }, { a: 5 }], cac: "rrr" },
          {
            $set: { hello: "world" },
            $inc: { bloup: 3 },
            // eslint-disable-next-line n/handle-callback-err
          },
          { upsert: true },
          function (err) {
            d.find({ hello: "world" }, function (err, docs) {
              assert.isNull(err);
              docs.length.should.equal(1);
              const doc = docs[0];
              Object.keys(doc).length.should.equal(4);
              doc.cac.should.equal("rrr");
              doc.hello.should.equal("world");
              doc.bloup.should.equal(3);
              done();
            });
          }
        );
      });

      it("Performing upsert with badly formatted fields yields a standard error not an exception", function (done) {
        d.update(
          { _id: "1234" },
          { $set: { $$badfield: 5 } },
          { upsert: true },
          function (err, doc) {
            assert.isDefined(err);
            done();
          }
        );
      });
    }); // ==== End of 'Upserts' ==== //

    it("Cannot perform update if the update query is not either registered-modifiers-only or copy-only, or contain badly formatted fields", function (done) {
      d.insert({ something: "yup" }, function () {
        d.update(
          {},
          { boom: { $badfield: 5 } },
          { multi: false },
          function (err) {
            assert.isDefined(err);

            d.update(
              {},
              { boom: { "bad.field": 5 } },
              { multi: false },
              function (err) {
                assert.isDefined(err);

                d.update(
                  {},
                  { $inc: { test: 5 }, mixed: "rrr" },
                  { multi: false },
                  function (err) {
                    assert.isDefined(err);

                    d.update(
                      {},
                      { $inexistent: { test: 5 } },
                      { multi: false },
                      function (err) {
                        assert.isDefined(err);

                        done();
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });

    it("Can update documents using multiple modifiers", function (done) {
      let id;

      // eslint-disable-next-line n/handle-callback-err
      d.insert({ something: "yup", other: 40 }, function (err, newDoc) {
        id = newDoc._id;

        d.update(
          {},
          { $set: { something: "changed" }, $inc: { other: 10 } },
          { multi: false },
          function (err, nr) {
            assert.isNull(err);
            nr.should.equal(1);

            // eslint-disable-next-line n/handle-callback-err
            d.findOne({ _id: id }, function (err, doc) {
              Object.keys(doc).length.should.equal(3);
              doc._id.should.equal(id);
              doc.something.should.equal("changed");
              doc.other.should.equal(50);

              done();
            });
          }
        );
      });
    });

    it("Can upsert a document even with modifiers", function (done) {
      d.update(
        { bloup: "blap" },
        { $set: { hello: "world" } },
        { upsert: true },
        function (err, nr, newDoc) {
          assert.isNull(err);
          nr.should.equal(1);
          newDoc.bloup.should.equal("blap");
          newDoc.hello.should.equal("world");
          assert.isDefined(newDoc._id);

          // eslint-disable-next-line n/handle-callback-err
          d.find({}, function (err, docs) {
            docs.length.should.equal(1);
            Object.keys(docs[0]).length.should.equal(3);
            docs[0].hello.should.equal("world");
            docs[0].bloup.should.equal("blap");
            assert.isDefined(docs[0]._id);

            done();
          });
        }
      );
    });

    it("When using modifiers, the only way to update subdocs is with the dot-notation", function (done) {
      d.insert({ bloup: { blip: "blap", other: true } }, function () {
        // Correct methos
        d.update({}, { $set: { "bloup.blip": "hello" } }, {}, function () {
          // eslint-disable-next-line n/handle-callback-err
          d.findOne({}, function (err, doc) {
            doc.bloup.blip.should.equal("hello");
            doc.bloup.other.should.equal(true);

            // Wrong
            d.update({}, { $set: { bloup: { blip: "ola" } } }, {}, function () {
              // eslint-disable-next-line n/handle-callback-err
              d.findOne({}, function (err, doc) {
                doc.bloup.blip.should.equal("ola");
                assert.isUndefined(doc.bloup.other); // This information was lost

                done();
              });
            });
          });
        });
      });
    });

    it("Returns an error if the query is not well formed", function (done) {
      d.insert({ hello: "world" }, function () {
        d.update(
          { $or: { hello: "world" } },
          { a: 1 },
          {},
          function (err, nr, upsert) {
            assert.isDefined(err);
            assert.isUndefined(nr);
            assert.isUndefined(upsert);

            done();
          }
        );
      });
    });

    it("If an error is thrown by a modifier, the database state is not changed", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ hello: "world" }, function (err, newDoc) {
        d.update({}, { $inc: { hello: 4 } }, {}, function (err, nr) {
          assert.isDefined(err);
          assert.isUndefined(nr);

          // eslint-disable-next-line n/handle-callback-err
          d.find({}, function (err, docs) {
            assert.deepStrictEqual(docs, [{ _id: newDoc._id, hello: "world" }]);

            done();
          });
        });
      });
    });

    it("Cant change the _id of a document", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 2 }, function (err, newDoc) {
        d.update({ a: 2 }, { a: 2, _id: "nope" }, {}, function (err) {
          assert.isDefined(err);

          // eslint-disable-next-line n/handle-callback-err
          d.find({}, function (err, docs) {
            docs.length.should.equal(1);
            Object.keys(docs[0]).length.should.equal(2);
            docs[0].a.should.equal(2);
            docs[0]._id.should.equal(newDoc._id);

            d.update({ a: 2 }, { $set: { _id: "nope" } }, {}, function (err) {
              assert.isDefined(err);

              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                docs.length.should.equal(1);
                Object.keys(docs[0]).length.should.equal(2);
                docs[0].a.should.equal(2);
                docs[0]._id.should.equal(newDoc._id);

                done();
              });
            });
          });
        });
      });
    });

    it("Non-multi updates are persistent", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 1, hello: "world" }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, hello: "earth" }, function (err, doc2) {
          d.update(
            { a: 2 },
            { $set: { hello: "changed" } },
            {},
            function (err) {
              assert.isNull(err);

              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                docs.sort(function (a, b) {
                  return a.a - b.a;
                });
                docs.length.should.equal(2);
                assert.deepStrictEqual(docs[0], {
                  _id: doc1._id,
                  a: 1,
                  hello: "world",
                });
                assert.deepStrictEqual(docs[1], {
                  _id: doc2._id,
                  a: 2,
                  hello: "changed",
                });

                // Even after a reload the database state hasn't changed
                d.loadDatabase(function (err) {
                  assert.isNull(err);

                  // eslint-disable-next-line n/handle-callback-err
                  d.find({}, function (err, docs) {
                    docs.sort(function (a, b) {
                      return a.a - b.a;
                    });
                    docs.length.should.equal(2);
                    assert.deepStrictEqual(docs[0], {
                      _id: doc1._id,
                      a: 1,
                      hello: "world",
                    });
                    assert.deepStrictEqual(docs[1], {
                      _id: doc2._id,
                      a: 2,
                      hello: "changed",
                    });

                    done();
                  });
                });
              });
            }
          );
        });
      });
    });

    it("Multi updates are persistent", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 1, hello: "world" }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, hello: "earth" }, function (err, doc2) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 5, hello: "pluton" }, function (err, doc3) {
            d.update(
              { a: { $in: [1, 2] } },
              { $set: { hello: "changed" } },
              { multi: true },
              function (err) {
                assert.isNull(err);

                // eslint-disable-next-line n/handle-callback-err
                d.find({}, function (err, docs) {
                  docs.sort(function (a, b) {
                    return a.a - b.a;
                  });
                  docs.length.should.equal(3);
                  assert.deepStrictEqual(docs[0], {
                    _id: doc1._id,
                    a: 1,
                    hello: "changed",
                  });
                  assert.deepStrictEqual(docs[1], {
                    _id: doc2._id,
                    a: 2,
                    hello: "changed",
                  });
                  assert.deepStrictEqual(docs[2], {
                    _id: doc3._id,
                    a: 5,
                    hello: "pluton",
                  });

                  // Even after a reload the database state hasn't changed
                  d.loadDatabase(function (err) {
                    assert.isNull(err);

                    // eslint-disable-next-line n/handle-callback-err
                    d.find({}, function (err, docs) {
                      docs.sort(function (a, b) {
                        return a.a - b.a;
                      });
                      docs.length.should.equal(3);
                      assert.deepStrictEqual(docs[0], {
                        _id: doc1._id,
                        a: 1,
                        hello: "changed",
                      });
                      assert.deepStrictEqual(docs[1], {
                        _id: doc2._id,
                        a: 2,
                        hello: "changed",
                      });
                      assert.deepStrictEqual(docs[2], {
                        _id: doc3._id,
                        a: 5,
                        hello: "pluton",
                      });

                      done();
                    });
                  });
                });
              }
            );
          });
        });
      });
    });

    it("Can update without the options arg (will use defaults then)", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 1, hello: "world" }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, hello: "earth" }, function (err, doc2) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 5, hello: "pluton" }, function (err, doc3) {
            d.update({ a: 2 }, { $inc: { a: 10 } }, function (err, nr) {
              assert.isNull(err);
              nr.should.equal(1);
              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                const d1 = docs.find(function (doc) {
                  return doc._id === doc1._id;
                });
                const d2 = docs.find(function (doc) {
                  return doc._id === doc2._id;
                });
                const d3 = docs.find(function (doc) {
                  return doc._id === doc3._id;
                });

                d1.a.should.equal(1);
                d2.a.should.equal(12);
                d3.a.should.equal(5);

                done();
              });
            });
          });
        });
      });
    });

    it("If a multi update fails on one document, previous updates should be rolled back", function (done) {
      d.ensureIndex({ fieldName: "a" });
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 4 }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 5 }, function (err, doc2) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: "abc" }, function (err, doc3) {
            // With this query, candidates are always returned in the order 4, 5, 'abc' so it's always the last one which fails
            d.update(
              { a: { $in: [4, 5, "abc"] } },
              { $inc: { a: 10 } },
              { multi: true },
              function (err) {
                assert.isDefined(err);

                // No index modified
                for (const key in d.indexes) {
                  if (Object.prototype.hasOwnProperty.call(d.indexes, key)) {
                    const index = d.indexes[key];
                    const docs = index.getAll();
                    const d1 = docs.find(function (doc) {
                      return doc._id === doc1._id;
                    });
                    const d2 = docs.find(function (doc) {
                      return doc._id === doc2._id;
                    });
                    const d3 = docs.find(function (doc) {
                      return doc._id === doc3._id;
                    });

                    // All changes rolled back, including those that didn't trigger an error
                    d1.a.should.equal(4);
                    d2.a.should.equal(5);
                    d3.a.should.equal("abc");
                  }
                }
                done();
              }
            );
          });
        });
      });
    });

    it("If an index constraint is violated by an update, all changes should be rolled back", function (done) {
      d.ensureIndex({ fieldName: "a", unique: true });
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 4 }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 5 }, function (err, doc2) {
          // With this query, candidates are always returned in the order 4, 5, 'abc' so it's always the last one which fails
          d.update(
            { a: { $in: [4, 5, "abc"] } },
            { $set: { a: 10 } },
            { multi: true },
            function (err) {
              assert.isDefined(err);

              // Check that no index was modified
              for (const key in d.indexes) {
                if (Object.prototype.hasOwnProperty.call(d.indexes, key)) {
                  const index = d.indexes[key];
                  const docs = index.getAll();
                  const d1 = docs.find(function (doc) {
                    return doc._id === doc1._id;
                  });
                  const d2 = docs.find(function (doc) {
                    return doc._id === doc2._id;
                  });

                  d1.a.should.equal(4);
                  d2.a.should.equal(5);
                }
              }
              done();
            }
          );
        });
      });
    });

    it("If options.returnUpdatedDocs is true, return all matched docs", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert([{ a: 4 }, { a: 5 }, { a: 6 }], function (err, docs) {
        docs.length.should.equal(3);

        d.update(
          { a: 7 },
          { $set: { u: 1 } },
          {
            multi: true,
            returnUpdatedDocs: true,
            // eslint-disable-next-line n/handle-callback-err
          },
          function (err, num, updatedDocs) {
            num.should.equal(0);
            updatedDocs.length.should.equal(0);

            d.update(
              { a: 5 },
              { $set: { u: 2 } },
              {
                multi: true,
                returnUpdatedDocs: true,
                // eslint-disable-next-line n/handle-callback-err
              },
              function (err, num, updatedDocs) {
                num.should.equal(1);
                updatedDocs.length.should.equal(1);
                updatedDocs[0].a.should.equal(5);
                updatedDocs[0].u.should.equal(2);

                d.update(
                  { a: { $in: [4, 6] } },
                  { $set: { u: 3 } },
                  {
                    multi: true,
                    returnUpdatedDocs: true,
                    // eslint-disable-next-line n/handle-callback-err
                  },
                  function (err, num, updatedDocs) {
                    num.should.equal(2);
                    updatedDocs.length.should.equal(2);
                    updatedDocs[0].u.should.equal(3);
                    updatedDocs[1].u.should.equal(3);
                    if (updatedDocs[0].a === 4) {
                      updatedDocs[0].a.should.equal(4);
                      updatedDocs[1].a.should.equal(6);
                    } else {
                      updatedDocs[0].a.should.equal(6);
                      updatedDocs[1].a.should.equal(4);
                    }

                    done();
                  }
                );
              }
            );
          }
        );
      });
    });

    it("createdAt property is unchanged and updatedAt correct after an update, even a complete document replacement", function (done) {
      const d2 = new Datastore({ inMemoryOnly: true, timestampData: true });
      d2.insert({ a: 1 });
      // eslint-disable-next-line n/handle-callback-err
      d2.findOne({ a: 1 }, function (err, doc) {
        const createdAt = doc.createdAt.getTime();

        // Modifying update
        setTimeout(function () {
          d2.update({ a: 1 }, { $set: { b: 2 } }, {});
          // eslint-disable-next-line n/handle-callback-err
          d2.findOne({ a: 1 }, function (err, doc) {
            doc.createdAt.getTime().should.equal(createdAt);
            assert.isBelow(Date.now() - doc.updatedAt.getTime(), 5);

            // Complete replacement
            setTimeout(function () {
              d2.update({ a: 1 }, { c: 3 }, {});
              // eslint-disable-next-line n/handle-callback-err
              d2.findOne({ c: 3 }, function (err, doc) {
                doc.createdAt.getTime().should.equal(createdAt);
                assert.isBelow(Date.now() - doc.updatedAt.getTime(), 5);

                done();
              });
            }, 20);
          });
        }, 20);
      });
    });

    describe("Callback signature", function () {
      it("Regular update, multi false", function (done) {
        d.insert({ a: 1 });
        d.insert({ a: 2 });

        // returnUpdatedDocs set to false
        d.update(
          { a: 1 },
          { $set: { b: 20 } },
          {},
          function (err, numAffected, affectedDocuments, upsert) {
            assert.isNull(err);
            numAffected.should.equal(1);
            assert.isNull(affectedDocuments);
            assert.isFalse(upsert);

            // returnUpdatedDocs set to true
            d.update(
              { a: 1 },
              { $set: { b: 21 } },
              { returnUpdatedDocs: true },
              function (err, numAffected, affectedDocuments, upsert) {
                assert.isNull(err);
                numAffected.should.equal(1);
                affectedDocuments.a.should.equal(1);
                affectedDocuments.b.should.equal(21);
                assert.isFalse(upsert);

                done();
              }
            );
          }
        );
      });

      it("Regular update, multi true", function (done) {
        d.insert({ a: 1 });
        d.insert({ a: 2 });

        // returnUpdatedDocs set to false
        d.update(
          {},
          { $set: { b: 20 } },
          { multi: true },
          function (err, numAffected, affectedDocuments, upsert) {
            assert.isNull(err);
            numAffected.should.equal(2);
            assert.isNull(affectedDocuments);
            assert.isFalse(upsert);

            // returnUpdatedDocs set to true
            d.update(
              {},
              { $set: { b: 21 } },
              {
                multi: true,
                returnUpdatedDocs: true,
              },
              function (err, numAffected, affectedDocuments, upsert) {
                assert.isNull(err);
                numAffected.should.equal(2);
                affectedDocuments.length.should.equal(2);
                assert.isFalse(upsert);

                done();
              }
            );
          }
        );
      });

      it("Upsert", function (done) {
        d.insert({ a: 1 });
        d.insert({ a: 2 });

        // Upsert flag not set
        d.update(
          { a: 3 },
          { $set: { b: 20 } },
          {},
          function (err, numAffected, affectedDocuments, upsert) {
            assert.isNull(err);
            numAffected.should.equal(0);
            assert.isNull(affectedDocuments);
            assert.isFalse(upsert);

            // Upsert flag set
            d.update(
              { a: 3 },
              { $set: { b: 21 } },
              { upsert: true },
              function (err, numAffected, affectedDocuments, upsert) {
                assert.isNull(err);
                numAffected.should.equal(1);
                affectedDocuments.a.should.equal(3);
                affectedDocuments.b.should.equal(21);
                upsert.should.equal(true);

                // eslint-disable-next-line n/handle-callback-err
                d.find({}, function (err, docs) {
                  docs.length.should.equal(3);
                  done();
                });
              }
            );
          }
        );
      });
    }); // ==== End of 'Update - Callback signature' ==== //
  }); // ==== End of 'Update' ==== //

  describe("Remove", function () {
    it("Can remove multiple documents", function (done) {
      let id1;

      // Test DB status
      function testPostUpdateState(cb) {
        // eslint-disable-next-line n/handle-callback-err
        d.find({}, function (err, docs) {
          docs.length.should.equal(1);

          Object.keys(docs[0]).length.should.equal(2);
          docs[0]._id.should.equal(id1);
          docs[0].somedata.should.equal("ok");

          return cb();
        });
      }

      // Actually launch the test
      waterfall(
        [
          function (cb) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ somedata: "ok" }, function (err, doc1) {
              id1 = doc1._id;
              // eslint-disable-next-line n/handle-callback-err
              d.insert(
                { somedata: "again", plus: "additional data" },
                function (err, doc2) {
                  d.insert({ somedata: "again" }, function (err, doc3) {
                    return cb(err);
                  });
                }
              );
            });
          },
          function (cb) {
            // Test with query that doesn't match anything
            d.remove({ somedata: "again" }, { multi: true }, function (err, n) {
              assert.isNull(err);
              n.should.equal(2);
              return cb();
            });
          },
          apply(testPostUpdateState),
          function (cb) {
            d.loadDatabase(function (err) {
              return cb(err);
            });
          },
          apply(testPostUpdateState),
        ],
        done
      );
    });

    // This tests concurrency issues
    it("Remove can be called multiple times in parallel and everything that needs to be removed will be", function (done) {
      d.insert({ planet: "Earth" }, function () {
        d.insert({ planet: "Mars" }, function () {
          d.insert({ planet: "Saturn" }, function () {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(3);

              // Remove two docs simultaneously
              const toRemove = ["Mars", "Saturn"];
              each(
                toRemove,
                function (planet, cb) {
                  d.remove({ planet }, function (err) {
                    return cb(err);
                  });
                  // eslint-disable-next-line n/handle-callback-err
                },
                function (err) {
                  // eslint-disable-next-line n/handle-callback-err
                  d.find({}, function (err, docs) {
                    docs.length.should.equal(1);

                    done();
                  });
                }
              );
            });
          });
        });
      });
    });

    it("Returns an error if the query is not well formed", function (done) {
      d.insert({ hello: "world" }, function () {
        d.remove({ $or: { hello: "world" } }, {}, function (err, nr, upsert) {
          assert.isDefined(err);
          assert.isUndefined(nr);
          assert.isUndefined(upsert);

          done();
        });
      });
    });

    it("Non-multi removes are persistent", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 1, hello: "world" }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, hello: "earth" }, function (err, doc2) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 3, hello: "moto" }, function (err, doc3) {
            d.remove({ a: 2 }, {}, function (err) {
              assert.isNull(err);

              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                docs.sort(function (a, b) {
                  return a.a - b.a;
                });
                docs.length.should.equal(2);
                assert.deepStrictEqual(docs[0], {
                  _id: doc1._id,
                  a: 1,
                  hello: "world",
                });
                assert.deepStrictEqual(docs[1], {
                  _id: doc3._id,
                  a: 3,
                  hello: "moto",
                });

                // Even after a reload the database state hasn't changed
                d.loadDatabase(function (err) {
                  assert.isNull(err);

                  // eslint-disable-next-line n/handle-callback-err
                  d.find({}, function (err, docs) {
                    docs.sort(function (a, b) {
                      return a.a - b.a;
                    });
                    docs.length.should.equal(2);
                    assert.deepStrictEqual(docs[0], {
                      _id: doc1._id,
                      a: 1,
                      hello: "world",
                    });
                    assert.deepStrictEqual(docs[1], {
                      _id: doc3._id,
                      a: 3,
                      hello: "moto",
                    });

                    done();
                  });
                });
              });
            });
          });
        });
      });
    });

    it("Multi removes are persistent", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 1, hello: "world" }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, hello: "earth" }, function (err, doc2) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 3, hello: "moto" }, function (err, doc3) {
            d.remove({ a: { $in: [1, 3] } }, { multi: true }, function (err) {
              assert.isNull(err);

              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                docs.length.should.equal(1);
                assert.deepStrictEqual(docs[0], {
                  _id: doc2._id,
                  a: 2,
                  hello: "earth",
                });

                // Even after a reload the database state hasn't changed
                d.loadDatabase(function (err) {
                  assert.isNull(err);

                  // eslint-disable-next-line n/handle-callback-err
                  d.find({}, function (err, docs) {
                    docs.length.should.equal(1);
                    assert.deepStrictEqual(docs[0], {
                      _id: doc2._id,
                      a: 2,
                      hello: "earth",
                    });

                    done();
                  });
                });
              });
            });
          });
        });
      });
    });

    it("Can remove without the options arg (will use defaults then)", function (done) {
      // eslint-disable-next-line n/handle-callback-err
      d.insert({ a: 1, hello: "world" }, function (err, doc1) {
        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, hello: "earth" }, function (err, doc2) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 5, hello: "pluton" }, function (err, doc3) {
            d.remove({ a: 2 }, function (err, nr) {
              assert.isNull(err);
              nr.should.equal(1);
              // eslint-disable-next-line n/handle-callback-err
              d.find({}, function (err, docs) {
                const d1 = docs.find(function (doc) {
                  return doc._id === doc1._id;
                });
                const d2 = docs.find(function (doc) {
                  return doc._id === doc2._id;
                });
                const d3 = docs.find(function (doc) {
                  return doc._id === doc3._id;
                });

                d1.a.should.equal(1);
                assert.isUndefined(d2);
                d3.a.should.equal(5);

                done();
              });
            });
          });
        });
      });
    });
  }); // ==== End of 'Remove' ==== //

  describe("Using indexes", function () {
    describe("ensureIndex and index initialization in database loading", function () {
      it("ensureIndex can be called right after a loadDatabase and be initialized and filled correctly", function (done) {
        const now = new Date();
        const rawData =
          model.serialize({ _id: "aaa", z: "1", a: 2, ages: [1, 5, 12] }) +
          "\n" +
          model.serialize({ _id: "bbb", z: "2", hello: "world" }) +
          "\n" +
          model.serialize({ _id: "ccc", z: "3", nested: { today: now } });

        d.getAllData().length.should.equal(0);

        fs.writeFile(testDb, rawData, "utf8", function () {
          d.loadDatabase(function () {
            d.getAllData().length.should.equal(3);

            assert.deepStrictEqual(Object.keys(d.indexes), ["_id"]);

            d.ensureIndex({ fieldName: "z" });
            d.indexes.z.fieldName.should.equal("z");
            d.indexes.z.unique.should.equal(false);
            d.indexes.z.sparse.should.equal(false);
            d.indexes.z.tree.getNumberOfKeys().should.equal(3);
            d.indexes.z.tree.search("1")[0].should.equal(d.getAllData()[0]);
            d.indexes.z.tree.search("2")[0].should.equal(d.getAllData()[1]);
            d.indexes.z.tree.search("3")[0].should.equal(d.getAllData()[2]);

            done();
          });
        });
      });

      it("ensureIndex can be called twice on the same field, the second call will have no effect", function (done) {
        Object.keys(d.indexes).length.should.equal(1);
        Object.keys(d.indexes)[0].should.equal("_id");

        d.insert({ planet: "Earth" }, function () {
          d.insert({ planet: "Mars" }, function () {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(2);

              d.ensureIndex({ fieldName: "planet" }, function (err) {
                assert.isNull(err);
                Object.keys(d.indexes).length.should.equal(2);
                Object.keys(d.indexes)[0].should.equal("_id");
                Object.keys(d.indexes)[1].should.equal("planet");

                d.indexes.planet.getAll().length.should.equal(2);

                // This second call has no effect, documents don't get inserted twice in the index
                d.ensureIndex({ fieldName: "planet" }, function (err) {
                  assert.isNull(err);
                  Object.keys(d.indexes).length.should.equal(2);
                  Object.keys(d.indexes)[0].should.equal("_id");
                  Object.keys(d.indexes)[1].should.equal("planet");

                  d.indexes.planet.getAll().length.should.equal(2);

                  done();
                });
              });
            });
          });
        });
      });

      it("ensureIndex can be called twice on the same compound fields, the second call will have no effect", function (done) {
        Object.keys(d.indexes).length.should.equal(1);
        Object.keys(d.indexes)[0].should.equal("_id");

        d.insert({ star: "sun", planet: "Earth" }, function () {
          d.insert({ star: "sun", planet: "Mars" }, function () {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(2);

              d.ensureIndex({ fieldName: ["star", "planet"] }, function (err) {
                assert.isNull(err);
                Object.keys(d.indexes).length.should.equal(2);
                Object.keys(d.indexes)[0].should.equal("_id");
                Object.keys(d.indexes)[1].should.equal("planet,star");

                d.indexes["planet,star"].getAll().length.should.equal(2);

                // This second call has no effect, documents don't get inserted twice in the index
                d.ensureIndex(
                  { fieldName: ["star", "planet"] },
                  function (err) {
                    assert.isNull(err);
                    Object.keys(d.indexes).length.should.equal(2);
                    Object.keys(d.indexes)[0].should.equal("_id");
                    Object.keys(d.indexes)[1].should.equal("planet,star");

                    d.indexes["planet,star"].getAll().length.should.equal(2);

                    done();
                  }
                );
              });
            });
          });
        });
      });

      it("ensureIndex can be called twice on the same compound fields with a different order, the second call will have no effect", function (done) {
        Object.keys(d.indexes).length.should.equal(1);
        Object.keys(d.indexes)[0].should.equal("_id");

        d.insert({ star: "sun", planet: "Earth" }, function () {
          d.insert({ star: "sun", planet: "Mars" }, function () {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(2);

              d.ensureIndex({ fieldName: ["star", "planet"] }, function (err) {
                assert.isNull(err);
                Object.keys(d.indexes).length.should.equal(2);
                Object.keys(d.indexes)[0].should.equal("_id");
                Object.keys(d.indexes)[1].should.equal("planet,star");

                d.indexes["planet,star"].getAll().length.should.equal(2);

                // This second call has no effect, documents don't get inserted twice in the index
                d.ensureIndex(
                  { fieldName: ["planet", "star"] },
                  function (err) {
                    assert.isNull(err);
                    Object.keys(d.indexes).length.should.equal(2);
                    Object.keys(d.indexes)[0].should.equal("_id");
                    Object.keys(d.indexes)[1].should.equal("planet,star");

                    d.indexes["planet,star"].getAll().length.should.equal(2);

                    done();
                  }
                );
              });
            });
          });
        });
      });

      it("ensureIndex cannot be called with an illegal field name", function (done) {
        d.ensureIndex({ fieldName: "star,planet" }, function (err) {
          assert.isNotNull(err);
          d.ensureIndex(
            { fieldName: ["star,planet", "other"] },
            function (err) {
              assert.isNotNull(err);
              done();
            }
          );
        });
      });

      it("ensureIndex can be called after the data set was modified and the index still be correct", function (done) {
        const rawData =
          model.serialize({ _id: "aaa", z: "1", a: 2, ages: [1, 5, 12] }) +
          "\n" +
          model.serialize({ _id: "bbb", z: "2", hello: "world" });

        d.getAllData().length.should.equal(0);

        fs.writeFile(testDb, rawData, "utf8", function () {
          d.loadDatabase(function () {
            d.getAllData().length.should.equal(2);

            assert.deepStrictEqual(Object.keys(d.indexes), ["_id"]);

            // eslint-disable-next-line n/handle-callback-err
            d.insert({ z: "12", yes: "yes" }, function (err, newDoc1) {
              // eslint-disable-next-line n/handle-callback-err
              d.insert({ z: "14", nope: "nope" }, function (err, newDoc2) {
                d.remove({ z: "2" }, {}, function () {
                  d.update(
                    { z: "1" },
                    { $set: { yes: "yep" } },
                    {},
                    function () {
                      assert.deepStrictEqual(Object.keys(d.indexes), ["_id"]);

                      d.ensureIndex({ fieldName: "z" });
                      d.indexes.z.fieldName.should.equal("z");
                      d.indexes.z.unique.should.equal(false);
                      d.indexes.z.sparse.should.equal(false);
                      d.indexes.z.tree.getNumberOfKeys().should.equal(3);

                      // The pointers in the _id and z indexes are the same
                      d.indexes.z.tree
                        .search("1")[0]
                        .should.equal(d.indexes._id.getMatching("aaa")[0]);
                      d.indexes.z.tree
                        .search("12")[0]
                        .should.equal(
                          d.indexes._id.getMatching(newDoc1._id)[0]
                        );
                      d.indexes.z.tree
                        .search("14")[0]
                        .should.equal(
                          d.indexes._id.getMatching(newDoc2._id)[0]
                        );

                      // The data in the z index is correct
                      // eslint-disable-next-line n/handle-callback-err
                      d.find({}, function (err, docs) {
                        const doc0 = docs.find(function (doc) {
                          return doc._id === "aaa";
                        });
                        const doc1 = docs.find(function (doc) {
                          return doc._id === newDoc1._id;
                        });
                        const doc2 = docs.find(function (doc) {
                          return doc._id === newDoc2._id;
                        });

                        docs.length.should.equal(3);

                        assert.deepStrictEqual(doc0, {
                          _id: "aaa",
                          z: "1",
                          a: 2,
                          ages: [1, 5, 12],
                          yes: "yep",
                        });
                        assert.deepStrictEqual(doc1, {
                          _id: newDoc1._id,
                          z: "12",
                          yes: "yes",
                        });
                        assert.deepStrictEqual(doc2, {
                          _id: newDoc2._id,
                          z: "14",
                          nope: "nope",
                        });

                        done();
                      });
                    }
                  );
                });
              });
            });
          });
        });
      });

      it("ensureIndex can be called before a loadDatabase and still be initialized and filled correctly", function (done) {
        const now = new Date();
        const rawData =
          model.serialize({ _id: "aaa", z: "1", a: 2, ages: [1, 5, 12] }) +
          "\n" +
          model.serialize({ _id: "bbb", z: "2", hello: "world" }) +
          "\n" +
          model.serialize({ _id: "ccc", z: "3", nested: { today: now } });

        d.getAllData().length.should.equal(0);

        d.ensureIndex({ fieldName: "z" }, function () {
          d.indexes.z.fieldName.should.equal("z");
          d.indexes.z.unique.should.equal(false);
          d.indexes.z.sparse.should.equal(false);
          d.indexes.z.tree.getNumberOfKeys().should.equal(0);

          fs.writeFile(testDb, rawData, "utf8", function () {
            d.loadDatabase(function () {
              const doc1 = d.getAllData().find(function (doc) {
                return doc.z === "1";
              });
              const doc2 = d.getAllData().find(function (doc) {
                return doc.z === "2";
              });
              const doc3 = d.getAllData().find(function (doc) {
                return doc.z === "3";
              });

              d.getAllData().length.should.equal(3);

              d.indexes.z.tree.getNumberOfKeys().should.equal(3);
              d.indexes.z.tree.search("1")[0].should.equal(doc1);
              d.indexes.z.tree.search("2")[0].should.equal(doc2);
              d.indexes.z.tree.search("3")[0].should.equal(doc3);

              done();
            });
          });
        });
      });

      it("Can initialize multiple indexes on a database load", function (done) {
        const now = new Date();
        const rawData =
          model.serialize({ _id: "aaa", z: "1", a: 2, ages: [1, 5, 12] }) +
          "\n" +
          model.serialize({ _id: "bbb", z: "2", a: "world" }) +
          "\n" +
          model.serialize({ _id: "ccc", z: "3", a: { today: now } });

        d.getAllData().length.should.equal(0);
        d.ensureIndex({ fieldName: "z" }, function () {
          d.ensureIndex({ fieldName: "a" }, function () {
            d.indexes.a.tree.getNumberOfKeys().should.equal(0);
            d.indexes.z.tree.getNumberOfKeys().should.equal(0);

            fs.writeFile(testDb, rawData, "utf8", function () {
              d.loadDatabase(function (err) {
                const doc1 = d.getAllData().find(function (doc) {
                  return doc.z === "1";
                });
                const doc2 = d.getAllData().find(function (doc) {
                  return doc.z === "2";
                });
                const doc3 = d.getAllData().find(function (doc) {
                  return doc.z === "3";
                });

                assert.isNull(err);
                d.getAllData().length.should.equal(3);

                d.indexes.z.tree.getNumberOfKeys().should.equal(3);
                d.indexes.z.tree.search("1")[0].should.equal(doc1);
                d.indexes.z.tree.search("2")[0].should.equal(doc2);
                d.indexes.z.tree.search("3")[0].should.equal(doc3);

                d.indexes.a.tree.getNumberOfKeys().should.equal(3);
                d.indexes.a.tree.search(2)[0].should.equal(doc1);
                d.indexes.a.tree.search("world")[0].should.equal(doc2);
                d.indexes.a.tree.search({ today: now })[0].should.equal(doc3);

                done();
              });
            });
          });
        });
      });

      it("If a unique constraint is not respected, database loading will not work and no data will be inserted", function (done) {
        const now = new Date();
        const rawData =
          model.serialize({ _id: "aaa", z: "1", a: 2, ages: [1, 5, 12] }) +
          "\n" +
          model.serialize({ _id: "bbb", z: "2", a: "world" }) +
          "\n" +
          model.serialize({ _id: "ccc", z: "1", a: { today: now } });

        d.getAllData().length.should.equal(0);

        d.ensureIndex({ fieldName: "z", unique: true }, function () {
          d.indexes.z.tree.getNumberOfKeys().should.equal(0);

          fs.writeFile(testDb, rawData, "utf8", function () {
            d.loadDatabase(function (err) {
              assert.isNotNull(err);
              err.errorType.should.equal("uniqueViolated");
              err.key.should.equal("1");
              d.getAllData().length.should.equal(0);
              d.indexes.z.tree.getNumberOfKeys().should.equal(0);

              done();
            });
          });
        });
      });

      it("If a unique constraint is not respected, ensureIndex will return an error and not create an index", function (done) {
        d.insert({ a: 1, b: 4 }, function () {
          d.insert({ a: 2, b: 45 }, function () {
            d.insert({ a: 1, b: 3 }, function () {
              d.ensureIndex({ fieldName: "b" }, function (err) {
                assert.isNull(err);

                d.ensureIndex({ fieldName: "a", unique: true }, function (err) {
                  err.errorType.should.equal("uniqueViolated");
                  assert.deepStrictEqual(Object.keys(d.indexes), ["_id", "b"]);

                  done();
                });
              });
            });
          });
        });
      });

      it("Can remove an index", function (done) {
        d.ensureIndex({ fieldName: "e" }, function (err) {
          assert.isNull(err);

          Object.keys(d.indexes).length.should.equal(2);
          assert.isNotNull(d.indexes.e);

          d.removeIndex("e", function (err) {
            assert.isNull(err);
            Object.keys(d.indexes).length.should.equal(1);
            assert.isUndefined(d.indexes.e);

            done();
          });
        });
      });
    }); // ==== End of 'ensureIndex and index initialization in database loading' ==== //

    describe("Indexing newly inserted documents", function () {
      it("Newly inserted documents are indexed", function (done) {
        d.ensureIndex({ fieldName: "z" });
        d.indexes.z.tree.getNumberOfKeys().should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, z: "yes" }, function (err, newDoc) {
          d.indexes.z.tree.getNumberOfKeys().should.equal(1);
          assert.deepStrictEqual(d.indexes.z.getMatching("yes"), [newDoc]);

          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 5, z: "nope" }, function (err, newDoc) {
            d.indexes.z.tree.getNumberOfKeys().should.equal(2);
            assert.deepStrictEqual(d.indexes.z.getMatching("nope"), [newDoc]);

            done();
          });
        });
      });

      it("If multiple indexes are defined, the document is inserted in all of them", function (done) {
        d.ensureIndex({ fieldName: "z" });
        d.ensureIndex({ fieldName: "ya" });
        d.indexes.z.tree.getNumberOfKeys().should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, z: "yes", ya: "indeed" }, function (err, newDoc) {
          d.indexes.z.tree.getNumberOfKeys().should.equal(1);
          d.indexes.ya.tree.getNumberOfKeys().should.equal(1);
          assert.deepStrictEqual(d.indexes.z.getMatching("yes"), [newDoc]);
          assert.deepStrictEqual(d.indexes.ya.getMatching("indeed"), [newDoc]);

          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 5, z: "nope", ya: "sure" }, function (err, newDoc2) {
            d.indexes.z.tree.getNumberOfKeys().should.equal(2);
            d.indexes.ya.tree.getNumberOfKeys().should.equal(2);
            assert.deepStrictEqual(d.indexes.z.getMatching("nope"), [newDoc2]);
            assert.deepStrictEqual(d.indexes.ya.getMatching("sure"), [newDoc2]);

            done();
          });
        });
      });

      it("Can insert two docs at the same key for a non unique index", function (done) {
        d.ensureIndex({ fieldName: "z" });
        d.indexes.z.tree.getNumberOfKeys().should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, z: "yes" }, function (err, newDoc) {
          d.indexes.z.tree.getNumberOfKeys().should.equal(1);
          assert.deepStrictEqual(d.indexes.z.getMatching("yes"), [newDoc]);

          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 5, z: "yes" }, function (err, newDoc2) {
            d.indexes.z.tree.getNumberOfKeys().should.equal(1);
            assert.deepStrictEqual(d.indexes.z.getMatching("yes"), [
              newDoc,
              newDoc2,
            ]);

            done();
          });
        });
      });

      it("If the index has a unique constraint, an error is thrown if it is violated and the data is not modified", function (done) {
        d.ensureIndex({ fieldName: "z", unique: true });
        d.indexes.z.tree.getNumberOfKeys().should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, z: "yes" }, function (err, newDoc) {
          d.indexes.z.tree.getNumberOfKeys().should.equal(1);
          assert.deepStrictEqual(d.indexes.z.getMatching("yes"), [newDoc]);

          d.insert({ a: 5, z: "yes" }, function (err) {
            err.errorType.should.equal("uniqueViolated");
            err.key.should.equal("yes");

            // Index didn't change
            d.indexes.z.tree.getNumberOfKeys().should.equal(1);
            assert.deepStrictEqual(d.indexes.z.getMatching("yes"), [newDoc]);

            // Data didn't change
            assert.deepStrictEqual(d.getAllData(), [newDoc]);
            d.loadDatabase(function () {
              d.getAllData().length.should.equal(1);
              assert.deepStrictEqual(d.getAllData()[0], newDoc);

              done();
            });
          });
        });
      });

      it("If an index has a unique constraint, other indexes cannot be modified when it raises an error", function (done) {
        d.ensureIndex({ fieldName: "nonu1" });
        d.ensureIndex({ fieldName: "uni", unique: true });
        d.ensureIndex({ fieldName: "nonu2" });

        d.insert(
          { nonu1: "yes", nonu2: "yes2", uni: "willfail" },
          function (err, newDoc) {
            assert.isNull(err);
            d.indexes.nonu1.tree.getNumberOfKeys().should.equal(1);
            d.indexes.uni.tree.getNumberOfKeys().should.equal(1);
            d.indexes.nonu2.tree.getNumberOfKeys().should.equal(1);

            d.insert(
              { nonu1: "no", nonu2: "no2", uni: "willfail" },
              function (err) {
                err.errorType.should.equal("uniqueViolated");

                // No index was modified
                d.indexes.nonu1.tree.getNumberOfKeys().should.equal(1);
                d.indexes.uni.tree.getNumberOfKeys().should.equal(1);
                d.indexes.nonu2.tree.getNumberOfKeys().should.equal(1);

                assert.deepStrictEqual(d.indexes.nonu1.getMatching("yes"), [
                  newDoc,
                ]);
                assert.deepStrictEqual(d.indexes.uni.getMatching("willfail"), [
                  newDoc,
                ]);
                assert.deepStrictEqual(d.indexes.nonu2.getMatching("yes2"), [
                  newDoc,
                ]);

                done();
              }
            );
          }
        );
      });

      it("Unique indexes prevent you from inserting two docs where the field is undefined except if theyre sparse", function (done) {
        d.ensureIndex({ fieldName: "zzz", unique: true });
        d.indexes.zzz.tree.getNumberOfKeys().should.equal(0);

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 2, z: "yes" }, function (err, newDoc) {
          d.indexes.zzz.tree.getNumberOfKeys().should.equal(1);
          assert.deepStrictEqual(d.indexes.zzz.getMatching(undefined), [
            newDoc,
          ]);

          d.insert({ a: 5, z: "other" }, function (err) {
            err.errorType.should.equal("uniqueViolated");
            assert.isUndefined(err.key);

            d.ensureIndex({ fieldName: "yyy", unique: true, sparse: true });

            d.insert({ a: 5, z: "other", zzz: "set" }, function (err) {
              assert.isNull(err);
              d.indexes.yyy.getAll().length.should.equal(0); // Nothing indexed
              d.indexes.zzz.getAll().length.should.equal(2);

              done();
            });
          });
        });
      });

      it("Insertion still works as before with indexing", function (done) {
        d.ensureIndex({ fieldName: "a" });
        d.ensureIndex({ fieldName: "b" });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: "si" }, function (err, doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              assert.deepStrictEqual(
                doc1,
                docs.find(function (d) {
                  return d._id === doc1._id;
                })
              );
              assert.deepStrictEqual(
                doc2,
                docs.find(function (d) {
                  return d._id === doc2._id;
                })
              );

              done();
            });
          });
        });
      });

      it("All indexes point to the same data as the main index on _id", function (done) {
        d.ensureIndex({ fieldName: "a" });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: "si" }, function (err, doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(2);
              d.getAllData().length.should.equal(2);

              d.indexes._id.getMatching(doc1._id).length.should.equal(1);
              d.indexes.a.getMatching(1).length.should.equal(1);
              d.indexes._id
                .getMatching(doc1._id)[0]
                .should.equal(d.indexes.a.getMatching(1)[0]);

              d.indexes._id.getMatching(doc2._id).length.should.equal(1);
              d.indexes.a.getMatching(2).length.should.equal(1);
              d.indexes._id
                .getMatching(doc2._id)[0]
                .should.equal(d.indexes.a.getMatching(2)[0]);

              done();
            });
          });
        });
      });

      it("If a unique constraint is violated, no index is changed, including the main one", function (done) {
        d.ensureIndex({ fieldName: "a", unique: true });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, doc1) {
          d.insert({ a: 1, b: "si" }, function (err) {
            assert.isDefined(err);

            // eslint-disable-next-line n/handle-callback-err
            d.find({}, function (err, docs) {
              docs.length.should.equal(1);
              d.getAllData().length.should.equal(1);

              d.indexes._id.getMatching(doc1._id).length.should.equal(1);
              d.indexes.a.getMatching(1).length.should.equal(1);
              d.indexes._id
                .getMatching(doc1._id)[0]
                .should.equal(d.indexes.a.getMatching(1)[0]);

              d.indexes.a.getMatching(2).length.should.equal(0);

              done();
            });
          });
        });
      });
    }); // ==== End of 'Indexing newly inserted documents' ==== //

    describe("Updating indexes upon document update", function () {
      it("Updating docs still works as before with indexing", function (done) {
        d.ensureIndex({ fieldName: "a" });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, _doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: "si" }, function (err, _doc2) {
            d.update(
              { a: 1 },
              { $set: { a: 456, b: "no" } },
              {},
              function (err, nr) {
                const data = d.getAllData();
                const doc1 = data.find(function (doc) {
                  return doc._id === _doc1._id;
                });
                const doc2 = data.find(function (doc) {
                  return doc._id === _doc2._id;
                });

                assert.isNull(err);
                nr.should.equal(1);

                data.length.should.equal(2);
                assert.deepStrictEqual(doc1, {
                  a: 456,
                  b: "no",
                  _id: _doc1._id,
                });
                assert.deepStrictEqual(doc2, { a: 2, b: "si", _id: _doc2._id });

                d.update(
                  {},
                  { $inc: { a: 10 }, $set: { b: "same" } },
                  { multi: true },
                  function (err, nr) {
                    const data = d.getAllData();
                    const doc1 = data.find(function (doc) {
                      return doc._id === _doc1._id;
                    });
                    const doc2 = data.find(function (doc) {
                      return doc._id === _doc2._id;
                    });

                    assert.isNull(err);
                    nr.should.equal(2);

                    data.length.should.equal(2);
                    assert.deepStrictEqual(doc1, {
                      a: 466,
                      b: "same",
                      _id: _doc1._id,
                    });
                    assert.deepStrictEqual(doc2, {
                      a: 12,
                      b: "same",
                      _id: _doc2._id,
                    });

                    done();
                  }
                );
              }
            );
          });
        });
      });

      it("Indexes get updated when a document (or multiple documents) is updated", function (done) {
        d.ensureIndex({ fieldName: "a" });
        d.ensureIndex({ fieldName: "b" });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: "si" }, function (err, doc2) {
            // Simple update
            d.update(
              { a: 1 },
              { $set: { a: 456, b: "no" } },
              {},
              function (err, nr) {
                assert.isNull(err);
                nr.should.equal(1);

                d.indexes.a.tree.getNumberOfKeys().should.equal(2);
                d.indexes.a.getMatching(456)[0]._id.should.equal(doc1._id);
                d.indexes.a.getMatching(2)[0]._id.should.equal(doc2._id);

                d.indexes.b.tree.getNumberOfKeys().should.equal(2);
                d.indexes.b.getMatching("no")[0]._id.should.equal(doc1._id);
                d.indexes.b.getMatching("si")[0]._id.should.equal(doc2._id);

                // The same pointers are shared between all indexes
                d.indexes.a.tree.getNumberOfKeys().should.equal(2);
                d.indexes.b.tree.getNumberOfKeys().should.equal(2);
                d.indexes._id.tree.getNumberOfKeys().should.equal(2);
                d.indexes.a
                  .getMatching(456)[0]
                  .should.equal(d.indexes._id.getMatching(doc1._id)[0]);
                d.indexes.b
                  .getMatching("no")[0]
                  .should.equal(d.indexes._id.getMatching(doc1._id)[0]);
                d.indexes.a
                  .getMatching(2)[0]
                  .should.equal(d.indexes._id.getMatching(doc2._id)[0]);
                d.indexes.b
                  .getMatching("si")[0]
                  .should.equal(d.indexes._id.getMatching(doc2._id)[0]);

                // Multi update
                d.update(
                  {},
                  { $inc: { a: 10 }, $set: { b: "same" } },
                  { multi: true },
                  function (err, nr) {
                    assert.isNull(err);
                    nr.should.equal(2);

                    d.indexes.a.tree.getNumberOfKeys().should.equal(2);
                    d.indexes.a.getMatching(466)[0]._id.should.equal(doc1._id);
                    d.indexes.a.getMatching(12)[0]._id.should.equal(doc2._id);

                    d.indexes.b.tree.getNumberOfKeys().should.equal(1);
                    d.indexes.b.getMatching("same").length.should.equal(2);
                    d.indexes.b
                      .getMatching("same")
                      .map((x) => x._id)
                      .should.contain(doc1._id);
                    d.indexes.b
                      .getMatching("same")
                      .map((x) => x._id)
                      .should.contain(doc2._id);

                    // The same pointers are shared between all indexes
                    d.indexes.a.tree.getNumberOfKeys().should.equal(2);
                    d.indexes.b.tree.getNumberOfKeys().should.equal(1);
                    d.indexes.b.getAll().length.should.equal(2);
                    d.indexes._id.tree.getNumberOfKeys().should.equal(2);
                    d.indexes.a
                      .getMatching(466)[0]
                      .should.equal(d.indexes._id.getMatching(doc1._id)[0]);
                    d.indexes.a
                      .getMatching(12)[0]
                      .should.equal(d.indexes._id.getMatching(doc2._id)[0]);
                    // Can't test the pointers in b as their order is randomized, but it is the same as with a

                    done();
                  }
                );
              }
            );
          });
        });
      });

      it("If a simple update violates a contraint, all changes are rolled back and an error is thrown", function (done) {
        d.ensureIndex({ fieldName: "a", unique: true });
        d.ensureIndex({ fieldName: "b", unique: true });
        d.ensureIndex({ fieldName: "c", unique: true });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: 10, c: 100 }, function (err, _doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: 20, c: 200 }, function (err, _doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ a: 3, b: 30, c: 300 }, function (err, _doc3) {
              // Will conflict with doc3
              d.update(
                { a: 2 },
                { $inc: { a: 10, c: 1000 }, $set: { b: 30 } },
                {},
                function (err) {
                  const data = d.getAllData();
                  const doc1 = data.find(function (doc) {
                    return doc._id === _doc1._id;
                  });
                  const doc2 = data.find(function (doc) {
                    return doc._id === _doc2._id;
                  });
                  const doc3 = data.find(function (doc) {
                    return doc._id === _doc3._id;
                  });

                  err.errorType.should.equal("uniqueViolated");

                  // Data left unchanged
                  data.length.should.equal(3);
                  assert.deepStrictEqual(doc1, {
                    a: 1,
                    b: 10,
                    c: 100,
                    _id: _doc1._id,
                  });
                  assert.deepStrictEqual(doc2, {
                    a: 2,
                    b: 20,
                    c: 200,
                    _id: _doc2._id,
                  });
                  assert.deepStrictEqual(doc3, {
                    a: 3,
                    b: 30,
                    c: 300,
                    _id: _doc3._id,
                  });

                  // All indexes left unchanged and pointing to the same docs
                  d.indexes.a.tree.getNumberOfKeys().should.equal(3);
                  d.indexes.a.getMatching(1)[0].should.equal(doc1);
                  d.indexes.a.getMatching(2)[0].should.equal(doc2);
                  d.indexes.a.getMatching(3)[0].should.equal(doc3);

                  d.indexes.b.tree.getNumberOfKeys().should.equal(3);
                  d.indexes.b.getMatching(10)[0].should.equal(doc1);
                  d.indexes.b.getMatching(20)[0].should.equal(doc2);
                  d.indexes.b.getMatching(30)[0].should.equal(doc3);

                  d.indexes.c.tree.getNumberOfKeys().should.equal(3);
                  d.indexes.c.getMatching(100)[0].should.equal(doc1);
                  d.indexes.c.getMatching(200)[0].should.equal(doc2);
                  d.indexes.c.getMatching(300)[0].should.equal(doc3);

                  done();
                }
              );
            });
          });
        });
      });

      it("If a multi update violates a contraint, all changes are rolled back and an error is thrown", function (done) {
        d.ensureIndex({ fieldName: "a", unique: true });
        d.ensureIndex({ fieldName: "b", unique: true });
        d.ensureIndex({ fieldName: "c", unique: true });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: 10, c: 100 }, function (err, _doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: 20, c: 200 }, function (err, _doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ a: 3, b: 30, c: 300 }, function (err, _doc3) {
              // Will conflict with doc3
              d.update(
                { a: { $in: [1, 2] } },
                {
                  $inc: { a: 10, c: 1000 },
                  $set: { b: 30 },
                },
                { multi: true },
                function (err) {
                  const data = d.getAllData();
                  const doc1 = data.find(function (doc) {
                    return doc._id === _doc1._id;
                  });
                  const doc2 = data.find(function (doc) {
                    return doc._id === _doc2._id;
                  });
                  const doc3 = data.find(function (doc) {
                    return doc._id === _doc3._id;
                  });

                  err.errorType.should.equal("uniqueViolated");

                  // Data left unchanged
                  data.length.should.equal(3);
                  assert.deepStrictEqual(doc1, {
                    a: 1,
                    b: 10,
                    c: 100,
                    _id: _doc1._id,
                  });
                  assert.deepStrictEqual(doc2, {
                    a: 2,
                    b: 20,
                    c: 200,
                    _id: _doc2._id,
                  });
                  assert.deepStrictEqual(doc3, {
                    a: 3,
                    b: 30,
                    c: 300,
                    _id: _doc3._id,
                  });

                  // All indexes left unchanged and pointing to the same docs
                  d.indexes.a.tree.getNumberOfKeys().should.equal(3);
                  d.indexes.a.getMatching(1)[0].should.equal(doc1);
                  d.indexes.a.getMatching(2)[0].should.equal(doc2);
                  d.indexes.a.getMatching(3)[0].should.equal(doc3);

                  d.indexes.b.tree.getNumberOfKeys().should.equal(3);
                  d.indexes.b.getMatching(10)[0].should.equal(doc1);
                  d.indexes.b.getMatching(20)[0].should.equal(doc2);
                  d.indexes.b.getMatching(30)[0].should.equal(doc3);

                  d.indexes.c.tree.getNumberOfKeys().should.equal(3);
                  d.indexes.c.getMatching(100)[0].should.equal(doc1);
                  d.indexes.c.getMatching(200)[0].should.equal(doc2);
                  d.indexes.c.getMatching(300)[0].should.equal(doc3);

                  done();
                }
              );
            });
          });
        });
      });
    }); // ==== End of 'Updating indexes upon document update' ==== //

    describe("Updating indexes upon document remove", function () {
      it("Removing docs still works as before with indexing", function (done) {
        d.ensureIndex({ fieldName: "a" });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, _doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: "si" }, function (err, _doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ a: 3, b: "coin" }, function (err, _doc3) {
              d.remove({ a: 1 }, {}, function (err, nr) {
                const data = d.getAllData();
                const doc2 = data.find(function (doc) {
                  return doc._id === _doc2._id;
                });
                const doc3 = data.find(function (doc) {
                  return doc._id === _doc3._id;
                });

                assert.isNull(err);
                nr.should.equal(1);

                data.length.should.equal(2);
                assert.deepStrictEqual(doc2, { a: 2, b: "si", _id: _doc2._id });
                assert.deepStrictEqual(doc3, {
                  a: 3,
                  b: "coin",
                  _id: _doc3._id,
                });

                d.remove(
                  { a: { $in: [2, 3] } },
                  { multi: true },
                  function (err, nr) {
                    const data = d.getAllData();

                    assert.isNull(err);
                    nr.should.equal(2);
                    data.length.should.equal(0);

                    done();
                  }
                );
              });
            });
          });
        });
      });

      it("Indexes get updated when a document (or multiple documents) is removed", function (done) {
        d.ensureIndex({ fieldName: "a" });
        d.ensureIndex({ fieldName: "b" });

        // eslint-disable-next-line n/handle-callback-err
        d.insert({ a: 1, b: "hello" }, function (err, doc1) {
          // eslint-disable-next-line n/handle-callback-err
          d.insert({ a: 2, b: "si" }, function (err, doc2) {
            // eslint-disable-next-line n/handle-callback-err
            d.insert({ a: 3, b: "coin" }, function (err, doc3) {
              // Simple remove
              d.remove({ a: 1 }, {}, function (err, nr) {
                assert.isNull(err);
                nr.should.equal(1);

                d.indexes.a.tree.getNumberOfKeys().should.equal(2);
                d.indexes.a.getMatching(2)[0]._id.should.equal(doc2._id);
                d.indexes.a.getMatching(3)[0]._id.should.equal(doc3._id);

                d.indexes.b.tree.getNumberOfKeys().should.equal(2);
                d.indexes.b.getMatching("si")[0]._id.should.equal(doc2._id);
                d.indexes.b.getMatching("coin")[0]._id.should.equal(doc3._id);

                // The same pointers are shared between all indexes
                d.indexes.a.tree.getNumberOfKeys().should.equal(2);
                d.indexes.b.tree.getNumberOfKeys().should.equal(2);
                d.indexes._id.tree.getNumberOfKeys().should.equal(2);
                d.indexes.a
                  .getMatching(2)[0]
                  .should.equal(d.indexes._id.getMatching(doc2._id)[0]);
                d.indexes.b
                  .getMatching("si")[0]
                  .should.equal(d.indexes._id.getMatching(doc2._id)[0]);
                d.indexes.a
                  .getMatching(3)[0]
                  .should.equal(d.indexes._id.getMatching(doc3._id)[0]);
                d.indexes.b
                  .getMatching("coin")[0]
                  .should.equal(d.indexes._id.getMatching(doc3._id)[0]);

                // Multi remove
                d.remove({}, { multi: true }, function (err, nr) {
                  assert.isNull(err);
                  nr.should.equal(2);

                  d.indexes.a.tree.getNumberOfKeys().should.equal(0);
                  d.indexes.b.tree.getNumberOfKeys().should.equal(0);
                  d.indexes._id.tree.getNumberOfKeys().should.equal(0);

                  done();
                });
              });
            });
          });
        });
      });
    }); // ==== End of 'Updating indexes upon document remove' ==== //

    describe("Persisting indexes", function () {
      it("Indexes are persisted to a separate file and recreated upon reload", function (done) {
        const persDb = "workspace/persistIndexes.db";
        let db;

        if (fs.existsSync(persDb)) {
          fs.writeFileSync(persDb, "", "utf8");
        }
        db = new Datastore({ filename: persDb, autoload: true });

        Object.keys(db.indexes).length.should.equal(1);
        Object.keys(db.indexes)[0].should.equal("_id");

        db.insert({ planet: "Earth" }, function (err) {
          assert.isNull(err);
          db.insert({ planet: "Mars" }, function (err) {
            assert.isNull(err);

            // eslint-disable-next-line n/handle-callback-err
            db.ensureIndex({ fieldName: "planet" }, function (err) {
              Object.keys(db.indexes).length.should.equal(2);
              Object.keys(db.indexes)[0].should.equal("_id");
              Object.keys(db.indexes)[1].should.equal("planet");
              db.indexes._id.getAll().length.should.equal(2);
              db.indexes.planet.getAll().length.should.equal(2);
              db.indexes.planet.fieldName.should.equal("planet");

              // After a reload the indexes are recreated
              db = new Datastore({ filename: persDb });
              db.loadDatabase(function (err) {
                assert.isNull(err);
                Object.keys(db.indexes).length.should.equal(2);
                Object.keys(db.indexes)[0].should.equal("_id");
                Object.keys(db.indexes)[1].should.equal("planet");
                db.indexes._id.getAll().length.should.equal(2);
                db.indexes.planet.getAll().length.should.equal(2);
                db.indexes.planet.fieldName.should.equal("planet");

                // After another reload the indexes are still there (i.e. they are preserved during autocompaction)
                db = new Datastore({ filename: persDb });
                db.loadDatabase(function (err) {
                  assert.isNull(err);
                  Object.keys(db.indexes).length.should.equal(2);
                  Object.keys(db.indexes)[0].should.equal("_id");
                  Object.keys(db.indexes)[1].should.equal("planet");
                  db.indexes._id.getAll().length.should.equal(2);
                  db.indexes.planet.getAll().length.should.equal(2);
                  db.indexes.planet.fieldName.should.equal("planet");

                  done();
                });
              });
            });
          });
        });
      });

      it("Indexes are persisted with their options and recreated even if some db operation happen between loads", function (done) {
        const persDb = "workspace/persistIndexes.db";
        let db;

        if (fs.existsSync(persDb)) {
          fs.writeFileSync(persDb, "", "utf8");
        }
        db = new Datastore({ filename: persDb, autoload: true });

        Object.keys(db.indexes).length.should.equal(1);
        Object.keys(db.indexes)[0].should.equal("_id");

        db.insert({ planet: "Earth" }, function (err) {
          assert.isNull(err);
          db.insert({ planet: "Mars" }, function (err) {
            assert.isNull(err);

            // eslint-disable-next-line n/handle-callback-err
            db.ensureIndex(
              { fieldName: "planet", unique: true, sparse: false },
              function (err) {
                Object.keys(db.indexes).length.should.equal(2);
                Object.keys(db.indexes)[0].should.equal("_id");
                Object.keys(db.indexes)[1].should.equal("planet");
                db.indexes._id.getAll().length.should.equal(2);
                db.indexes.planet.getAll().length.should.equal(2);
                db.indexes.planet.unique.should.equal(true);
                db.indexes.planet.sparse.should.equal(false);

                db.insert({ planet: "Jupiter" }, function (err) {
                  assert.isNull(err);

                  // After a reload the indexes are recreated
                  db = new Datastore({ filename: persDb });
                  db.loadDatabase(function (err) {
                    assert.isNull(err);
                    Object.keys(db.indexes).length.should.equal(2);
                    Object.keys(db.indexes)[0].should.equal("_id");
                    Object.keys(db.indexes)[1].should.equal("planet");
                    db.indexes._id.getAll().length.should.equal(3);
                    db.indexes.planet.getAll().length.should.equal(3);
                    db.indexes.planet.unique.should.equal(true);
                    db.indexes.planet.sparse.should.equal(false);

                    db.ensureIndex(
                      { fieldName: "bloup", unique: false, sparse: true },
                      function (err) {
                        assert.isNull(err);
                        Object.keys(db.indexes).length.should.equal(3);
                        Object.keys(db.indexes)[0].should.equal("_id");
                        Object.keys(db.indexes)[1].should.equal("planet");
                        Object.keys(db.indexes)[2].should.equal("bloup");
                        db.indexes._id.getAll().length.should.equal(3);
                        db.indexes.planet.getAll().length.should.equal(3);
                        db.indexes.bloup.getAll().length.should.equal(0);
                        db.indexes.planet.unique.should.equal(true);
                        db.indexes.planet.sparse.should.equal(false);
                        db.indexes.bloup.unique.should.equal(false);
                        db.indexes.bloup.sparse.should.equal(true);

                        // After another reload the indexes are still there (i.e. they are preserved during autocompaction)
                        db = new Datastore({ filename: persDb });
                        db.loadDatabase(function (err) {
                          assert.isNull(err);
                          Object.keys(db.indexes).length.should.equal(3);
                          Object.keys(db.indexes)[0].should.equal("_id");
                          Object.keys(db.indexes)[1].should.equal("planet");
                          Object.keys(db.indexes)[2].should.equal("bloup");
                          db.indexes._id.getAll().length.should.equal(3);
                          db.indexes.planet.getAll().length.should.equal(3);
                          db.indexes.bloup.getAll().length.should.equal(0);
                          db.indexes.planet.unique.should.equal(true);
                          db.indexes.planet.sparse.should.equal(false);
                          db.indexes.bloup.unique.should.equal(false);
                          db.indexes.bloup.sparse.should.equal(true);

                          done();
                        });
                      }
                    );
                  });
                });
              }
            );
          });
        });
      });

      it("Indexes can also be removed and the remove persisted", function (done) {
        const persDb = "workspace/persistIndexes.db";
        let db;

        if (fs.existsSync(persDb)) {
          fs.writeFileSync(persDb, "", "utf8");
        }
        db = new Datastore({ filename: persDb, autoload: true });

        Object.keys(db.indexes).length.should.equal(1);
        Object.keys(db.indexes)[0].should.equal("_id");

        db.insert({ planet: "Earth" }, function (err) {
          assert.isNull(err);
          db.insert({ planet: "Mars" }, function (err) {
            assert.isNull(err);

            db.ensureIndex({ fieldName: "planet" }, function (err) {
              assert.isNull(err);
              db.ensureIndex({ fieldName: "another" }, function (err) {
                assert.isNull(err);
                Object.keys(db.indexes).length.should.equal(3);
                Object.keys(db.indexes)[0].should.equal("_id");
                Object.keys(db.indexes)[1].should.equal("planet");
                Object.keys(db.indexes)[2].should.equal("another");
                db.indexes._id.getAll().length.should.equal(2);
                db.indexes.planet.getAll().length.should.equal(2);
                db.indexes.planet.fieldName.should.equal("planet");

                // After a reload the indexes are recreated
                db = new Datastore({ filename: persDb });
                db.loadDatabase(function (err) {
                  assert.isNull(err);
                  Object.keys(db.indexes).length.should.equal(3);
                  Object.keys(db.indexes)[0].should.equal("_id");
                  Object.keys(db.indexes)[1].should.equal("planet");
                  Object.keys(db.indexes)[2].should.equal("another");
                  db.indexes._id.getAll().length.should.equal(2);
                  db.indexes.planet.getAll().length.should.equal(2);
                  db.indexes.planet.fieldName.should.equal("planet");

                  // Index is removed
                  db.removeIndex("planet", function (err) {
                    assert.isNull(err);
                    Object.keys(db.indexes).length.should.equal(2);
                    Object.keys(db.indexes)[0].should.equal("_id");
                    Object.keys(db.indexes)[1].should.equal("another");
                    db.indexes._id.getAll().length.should.equal(2);

                    // After a reload indexes are preserved
                    db = new Datastore({ filename: persDb });
                    db.loadDatabase(function (err) {
                      assert.isNull(err);
                      Object.keys(db.indexes).length.should.equal(2);
                      Object.keys(db.indexes)[0].should.equal("_id");
                      Object.keys(db.indexes)[1].should.equal("another");
                      db.indexes._id.getAll().length.should.equal(2);

                      // After another reload the indexes are still there (i.e. they are preserved during autocompaction)
                      db = new Datastore({ filename: persDb });
                      db.loadDatabase(function (err) {
                        assert.isNull(err);
                        Object.keys(db.indexes).length.should.equal(2);
                        Object.keys(db.indexes)[0].should.equal("_id");
                        Object.keys(db.indexes)[1].should.equal("another");
                        db.indexes._id.getAll().length.should.equal(2);

                        done();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    }); // ==== End of 'Persisting indexes' ====

    it("Results of getMatching should never contain duplicates", function (done) {
      d.ensureIndex({ fieldName: "bad" });
      d.insert({ bad: ["a", "b"] }, function () {
        // eslint-disable-next-line n/handle-callback-err
        callbackify((query) => d._getCandidatesAsync(query))(
          { bad: { $in: ["a", "b"] } },
          function (err, res) {
            res.length.should.equal(1);
            done();
          }
        );
      });
    });
  }); // ==== End of 'Using indexes' ==== //
});
