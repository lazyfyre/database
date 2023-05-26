/* eslint-env mocha, browser */
/* global Nedb, localforage, testUtils */

const N = 5000
const db = new Nedb({ filename: 'loadTest', autoload: true })
const sample = JSON.stringify({ data: Math.random(), _id: Math.random() })

// Some inserts in sequence, using the default storage mechanism (IndexedDB in my case)
const someInserts = (sn, N, callback) => {
  const beg = Date.now()
  let i = 0
  testUtils.whilst(() => i < N, _cb => {
    db.insert({ data: Math.random() }, err => { i += 1; return _cb(err) })
  }, err => {
    console.log('Inserts, series ' + sn + ' ' + (Date.now() - beg))
    return callback(err)
  })
}

// Manually updating the localStorage on the same variable
const someLS = (sn, N, callback) => {
  const beg = Date.now()
  for (let i = 0; i < N; i += 1) {
    localStorage.setItem('loadTestLS', localStorage.getItem('loadTestLS') + sample)
  }
  console.log('localStorage, series ' + sn + ' ' + (Date.now() - beg))
  return callback()
}

// Manually updating the localStorage on different variables
const someLSDiff = (sn, N, callback) => {
  const beg = Date.now()
  for (let i = 0; i < N; i += 1) {
    localStorage.setItem('loadTestLS-' + i, sample)
  }
  console.log('localStorage, series ' + sn + ' ' + (Date.now() - beg))
  return callback()
}

// Manually updating the localforage default on the same variable (IndexedDB on my machine)
function someLF (sn, N, callback) {
  const beg = Date.now()
  let i = 0
  testUtils.whilst(() => i < N, _cb => {
    localforage.getItem('loadTestLF', (err, value) => {
      if (err) return _cb(err)
      localforage.setItem('loadTestLF', value + sample, err => { i += 1; return _cb(err) })
    })
  }, err => {
    console.log('localForage/IDB, series ' + sn + ' ' + (Date.now() - beg))
    return callback(err)
  })
}

// Manually updating the localforage default on the different variables (IndexedDB on my machine)
const someLFDiff = (sn, N, callback) => {
  const beg = Date.now()
  let i = 0
  testUtils.whilst(() => i < N, _cb => {
    localforage.setItem('loadTestLF-' + i, sample, err => { i += 1; return _cb(err) })
  }, err => {
    console.log('localForage/IDB, series ' + sn + ' ' + (Date.now() - beg))
    return callback(err)
  })
}

// These tests benchmark various key/value storage methods, we skip them by default
describe.skip('Load tests', function () {
  this.timeout(60000)
  before('Cleanup', function (done) {
    localStorage.setItem('loadTestLS', '')
    db.remove({}, { multi: true }, err => done(err))
  })

  it.skip('Inserts', function (done) {
    testUtils.waterfall([
      // Slow and gets slower with database size
      testUtils.apply(someInserts, '#1', N), // N=5000, 141s
      testUtils.apply(someInserts, '#2', N), // N=5000, 208s
      testUtils.apply(someInserts, '#3', N), // N=5000, 281s
      testUtils.apply(someInserts, '#4', N) // N=5000, 350s
    ], done)
  })

  it.skip('Localstorage', function (done) {
    testUtils.waterfall([
      // Slow and gets slower really fast with database size, then outright crashes
      testUtils.apply(someLS, '#1', N), // N=4000, 2.5s
      testUtils.apply(someLS, '#2', N), // N=4000, 8.0s
      testUtils.apply(someLS, '#3', N), // N=4000, 26.5s
      testUtils.apply(someLS, '#4', N) // N=4000, 47.8s then crash, can't get string (with N=5000 crash happens on second pass)
    ], done)
  })

  it.skip('Localstorage Diff', function (done) {
    testUtils.waterfall([
      // Much faster and more consistent
      testUtils.apply(someLSDiff, '#1', N), // N=50000, 0.7s
      testUtils.apply(someLSDiff, '#2', N), // N=50000, 0.5s
      testUtils.apply(someLSDiff, '#3', N), // N=50000, 0.5s
      testUtils.apply(someLSDiff, '#4', N) // N=50000, 0.5s
    ], done)
  })

  it.skip('LocalForage', function (done) {
    testUtils.waterfall([
      // Slow and gets slower with database size
      cb => { localforage.setItem('loadTestLF', '', err => cb(err)) },
      testUtils.apply(someLF, '#1', N), // N=5000, 69s
      testUtils.apply(someLF, '#2', N), // N=5000, 108s
      testUtils.apply(someLF, '#3', N), // N=5000, 137s
      testUtils.apply(someLF, '#4', N) // N=5000, 169s
    ], done)
  })

  it.skip('LocalForage diff', function (done) {
    testUtils.waterfall([
      // Quite fast and speed doesn't change with database size (tested with N=10000 and N=50000, still no slow-down)
      testUtils.apply(someLFDiff, '#1', N), // N=5000, 18s
      testUtils.apply(someLFDiff, '#2', N), // N=5000, 18s
      testUtils.apply(someLFDiff, '#3', N), // N=5000, 18s
      testUtils.apply(someLFDiff, '#4', N) // N=5000, 18s
    ], done)
  })
})
