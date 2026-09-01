export default class P2P {
  static id = "p2p";
  static name = "Direct P2P Torrent (No Debrid)";
  static shortName = "P2P";
  static configFields = [];

  constructor(userConfig) {
    this.userConfig = userConfig;
    this.id = P2P.id;
    this.name = P2P.name;
    this.shortName = P2P.shortName;
  }

  async getUserHash() {
    return "p2p";
  }

  async getTorrentsCached(torrents, isValidCachedFiles) {
    return torrents.map(t => { t.isCached = true; return t; });
  }

  async getProgressTorrents(torrents) {
    return {};
  }

  async getFilesFromMagnet(magnetUrl, infoHash) {
    return [{ name: infoHash, size: 0, infoHash, url: magnetUrl, link: magnetUrl }];
  }

  async getFilesFromBuffer(buffer, infoHash) {
    const magnet = "magnet:?xt=urn:btih:" + infoHash;
    return [{ name: infoHash, size: 0, infoHash, url: magnet, link: magnet }];
  }

  async getFilesFromHash(infoHash) {
    const magnet = "magnet:?xt=urn:btih:" + infoHash;
    return [{ name: infoHash, size: 0, infoHash, url: magnet, link: magnet }];
  }

  async getDownload(file) {
    return file.url || file.link || ("magnet:?xt=urn:btih:" + file.infoHash);
  }
}
