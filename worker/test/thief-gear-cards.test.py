import hashlib,importlib.util,unittest
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cards',ROOT/'worker/scripts/render-thief-gear-cards.py')
cards=importlib.util.module_from_spec(spec);spec.loader.exec_module(cards)
class CardsTest(unittest.TestCase):
 def test_six_frames_retain_real_ring_hole_and_leave_native_source_unchanged(self):
  source=ROOT/'worker/public/art/v2/gear_ring_laurel.webp'
  before=hashlib.sha256(source.read_bytes()).hexdigest();seen=set()
  im=Image.open(source).convert('RGBA')
  # Select an actually transparent point well inside the real ring, avoiding interpolated edges.
  candidates=[(x,y) for y in range(130,180) for x in range(95,145) if max(im.getchannel('A').crop((x-3,y-3,x+4,y+4)).getextrema())==0]
  self.assertTrue(candidates);point=candidates[len(candidates)//2]
  for rarity in cards.RARITIES:
   result,meta=cards.compose_card(source,{'name':'月桂紋章戒','tier':1},rarity)
   self.assertEqual(result.size,(480,480));self.assertEqual(result.mode,'RGB')
   self.assertEqual(meta['cardScale'],1)
   box=meta['sourceAlphaBounds'];position=meta['placementPx']
   at=(point[0]-box[0]+position[0],point[1]-box[1]+position[1])
   self.assertEqual(result.getpixel(at),cards.rarity_frame(rarity).convert('RGB').getpixel(at),'a transparent ring hole must expose only the new frame background')
   seen.add(hashlib.sha256(result.tobytes()).hexdigest())
  self.assertEqual(len(seen),6);self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
 def test_new_frames_are_programmatic_and_never_open_composed_old_jpg_cards(self):
  text=(ROOT/'worker/scripts/render-thief-gear-cards.py').read_text(encoding='utf-8')
  self.assertNotIn('equipment-20261011-r2',text)
  self.assertIn('sourceNativeIconsChanged',text)
if __name__=='__main__':unittest.main()
