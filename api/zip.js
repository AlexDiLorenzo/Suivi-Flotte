/* Archive ZIP minimale, écrite à la volée dans un flux HTTP.
 *
 * Méthode « stored » (aucune compression) : les pièces stockées sont des PDF
 * et des JPEG/PNG, déjà compressés — déflater ne gagnerait presque rien et
 * obligerait à tamponner. Chaque document est écrit dès qu'il est lu en base,
 * la mémoire ne contient donc jamais plus d'un fichier à la fois.
 *
 * Pas de ZIP64 : l'API plafonne chaque pièce à 20 Mo et l'archive complète
 * reste très en deçà des 4 Go (une erreur est levée si ce n'était plus le cas).
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Horodatage MS-DOS (résolution 2 s, années à partir de 1980)
function dosStamp(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const MAX_OFFSET = 0xffffffff;

export default class ZipWriter {
  /** @param out flux inscriptible (la réponse HTTP) */
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
    this.names = new Set();
  }

  /* Rend le nom unique dans l'archive : « doc.pdf » puis « doc (2).pdf ». */
  uniqueName(raw) {
    const base = String(raw || "document")
      .replace(/[\\/:*?"<>|]/g, "-")
      .split("")
      .filter((ch) => ch.charCodeAt(0) > 31)
      .join("")
      .trim()
      .slice(0, 180) || "document";
    if (!this.names.has(base.toLowerCase())) {
      this.names.add(base.toLowerCase());
      return base;
    }
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!this.names.has(candidate.toLowerCase())) {
        this.names.add(candidate.toLowerCase());
        return candidate;
      }
    }
  }

  /* Le client a coupé (onglet fermé, téléchargement annulé) : inutile de
     continuer à lire les documents en base. */
  get aborted() {
    return this.out.destroyed || this.out.writableEnded;
  }

  /* Écrit en respectant la contre-pression du flux. */
  async write(buf) {
    if (this.aborted) throw new Error("Téléchargement interrompu");
    this.offset += buf.length;
    if (this.offset > MAX_OFFSET) throw new Error("Archive trop volumineuse");
    if (!this.out.write(buf)) {
      await new Promise((resolve, reject) => {
        const done = (err) => {
          this.out.off("drain", ok);
          this.out.off("error", fail);
          this.out.off("close", closed);
          err ? reject(err) : resolve();
        };
        const ok = () => done();
        const fail = (err) => done(err);
        const closed = () => done(new Error("Téléchargement interrompu"));
        this.out.once("drain", ok);
        this.out.once("error", fail);
        this.out.once("close", closed);
      });
    }
  }

  /** Ajoute un fichier. `data` est un Buffer complet. */
  async add(rawName, data, mtime) {
    const name = this.uniqueName(rawName);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const { time, date } = dosStamp(mtime);
    const localOffset = this.offset;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);  // signature
    header.writeUInt16LE(20, 4);          // version minimale
    header.writeUInt16LE(0x0800, 6);      // drapeaux : nom en UTF-8
    header.writeUInt16LE(0, 8);           // méthode : stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);          // pas de champ « extra »

    await this.write(header);
    await this.write(nameBuf);
    await this.write(data);

    this.entries.push({ nameBuf, crc, size: data.length, time, date, localOffset });
  }

  /** Écrit le répertoire central et clôt l'archive. */
  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const rec = Buffer.alloc(46);
      rec.writeUInt32LE(0x02014b50, 0);   // signature
      rec.writeUInt16LE(20, 4);           // version d'écriture
      rec.writeUInt16LE(20, 6);           // version minimale
      rec.writeUInt16LE(0x0800, 8);
      rec.writeUInt16LE(0, 10);
      rec.writeUInt16LE(e.time, 12);
      rec.writeUInt16LE(e.date, 14);
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.size, 20);
      rec.writeUInt32LE(e.size, 24);
      rec.writeUInt16LE(e.nameBuf.length, 28);
      rec.writeUInt16LE(0, 30);           // extra
      rec.writeUInt16LE(0, 32);           // commentaire
      rec.writeUInt16LE(0, 34);           // disque
      rec.writeUInt16LE(0, 36);           // attributs internes
      rec.writeUInt32LE(0, 38);           // attributs externes
      rec.writeUInt32LE(e.localOffset, 42);
      await this.write(rec);
      await this.write(e.nameBuf);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);             // disque courant
    eocd.writeUInt16LE(0, 6);             // disque du répertoire
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(this.offset - start, 12);
    eocd.writeUInt32LE(start, 16);
    eocd.writeUInt16LE(0, 20);            // commentaire
    await this.write(eocd);
  }
}
