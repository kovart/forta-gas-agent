const fs = require('fs');
const path = require('path');

const Storage = {
  async saveFile(dir, name, data) {
    const fullPath = path.resolve(dir, name + '.json');
    return fs.promises.writeFile(fullPath, JSON.stringify(data), { encoding: 'utf-8' });
  },
  async readFile(dir, name) {
    const fullPath = path.resolve(dir, name + '.json');
    const str = await fs.promises.readFile(fullPath, 'utf-8');
    return JSON.parse(str);
  },
  readFileNames: async function (dir, extensions = false) {
    return (await fs.promises.readdir(dir)).map((f) => {
      return extensions ? f : path.parse(f).name;
    });
  },
};

module.exports = Storage;
