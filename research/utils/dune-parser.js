const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const csv = require('fast-csv');
const storage = require('./storage');

// This script helps to prepare Dune data
// ------------------------------------------

const SRC_PATH = path.resolve(__dirname, '../data/dune/');
const DIST_PATH = path.resolve(__dirname, '../src/data/')
const DATE_KEYS = ['block_time']

async function read(path) {
  const data = [];
  const files = await storage.readFileNames(path);

  for (const file of files) {
    data.push({
      name: file,
      content: parse(await storage.readFile(path, file), DATE_KEYS)
    })
  }

  return data;
}

function parse(obj, dateKeys = []) {
  const keys = ['get_result_by_result_id','get_result_by_job_id']
  const key = keys.find(key => obj.data[key]?.length > 0);

  if(!key) throw new Error('cannot find data array')

  return obj.data[key].map(v => {
    const obj = v.data;
    for (const key of dateKeys) {
      obj[key] = dayjs(v.data[key]).unix()
    }
    return obj;
  })
}

function write(arr, path) {
  const csvStream = csv.format({headers: true});
  csvStream.pipe(fs.createWriteStream(path));

  for (const item of arr) {
    csvStream.write(item, 'utf8')
  }
  csvStream.end();
}

async function init() {
  const files = await read(SRC_PATH);

  await fs.promises.mkdir(DIST_PATH, {recursive: true});

  for (const file of files) {
    const filePath = path.resolve(DIST_PATH, file.name + '.csv')
    try {
      await fs.promises.unlink(filePath);
      // eslint-disable-next-line no-empty
    } catch {
    }
    await write(file.content, filePath)
  }
}

init();