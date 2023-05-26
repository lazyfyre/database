const { apply, waterfall } = require('../test/utils.test.js')
const commonUtilities = require('./commonUtilities')
const Profiler = require('./profiler')

const benchDb = 'workspace/remove.bench.db'
const profiler = new Profiler('REMOVE BENCH')
const config = commonUtilities.getConfiguration(benchDb)
const d = config.d
const n = config.n

waterfall([
  apply(commonUtilities.prepareDb, benchDb),
  function (cb) {
    d.loadDatabase(function (err) {
      if (err) { return cb(err) }
      if (config.program.withIndex) { d.ensureIndex({ fieldName: 'docNumber' }) }
      cb()
    })
  },
  function (cb) { profiler.beginProfiling(); return cb() },
  apply(commonUtilities.insertDocs, d, n, profiler),

  // Test with remove only one document
  function (cb) { profiler.step('MULTI: FALSE'); return cb() },
  apply(commonUtilities.removeDocs, { multi: false }, d, n, profiler),
  // Test with multiple documents
  function (cb) { d.remove({}, { multi: true }, function () { return cb() }) },
  apply(commonUtilities.insertDocs, d, n, profiler),
  function (cb) { profiler.step('MULTI: TRUE'); return cb() },
  apply(commonUtilities.removeDocs, { multi: true }, d, n, profiler)
], function (err) {
  profiler.step('Benchmark finished')

  if (err) { return console.log('An error was encountered: ', err) }
})
