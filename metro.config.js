const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// O disco externo cria arquivos fantasma "._*" do macOS; o empacotador deve ignorá-los.
const ghost = /(^|[\\/])\._[^\\/]*$/;
const prev = config.resolver.blockList;
config.resolver.blockList = [].concat(prev ?? [], ghost);
module.exports = config;
