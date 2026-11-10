// Versioned public art folders that are not produced from the reviewed scene
// source but must stay in the hash-bound release manifest. The scene release
// builder rebuilds the manifest from scratch, so every such folder is declared
// here once; dropping a folder from this list drops its entries.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const RELEASE_ASSET_FOLDERS = Object.freeze([
  Object.freeze({folder:'art/materials-20261110',pattern:/\.(?:png|json)$/,kind:'material-art',source:'imagegen-20261110'}),
  Object.freeze({folder:'ui/button-materials/buttons-3d-20261110',pattern:/\.(?:webp|png)$/,kind:'ui-art',source:'ui-buttons/buttons_3d_v1.png'}),
]);

export async function collectReleaseAssets(publicRoot,folders=RELEASE_ASSET_FOLDERS){
  const out=[];
  for(const {folder,pattern,kind,source} of folders){
    let files;try{files=(await fs.readdir(path.join(publicRoot,folder))).sort();}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const file of files){
      if(!pattern.test(file))continue;
      const data=await fs.readFile(path.join(publicRoot,folder,file)),url='/'+folder+'/'+file;
      out.push({url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),kind,source});
    }
  }
  return out;
}
