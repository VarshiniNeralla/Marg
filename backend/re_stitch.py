import asyncio
import os
import re
from pathlib import Path
from app.db.mongodb import connect_db, get_database
from app.services.cloudinary_service import upload_media

scratchpad = Path(r'C:\Users\srivarshini.n\AppData\Local\Temp\claude\d--Srivarshini-N-Documents-virtual-room-tour\767aeaf8-337a-4393-8811-d281db90ff2a\scratchpad\raw')

async def process():
    await connect_db()
    db = get_database()
    cursor = db['captures'].find({})
    
    count = 0
    async for cap in cursor:
        cap_str = str(cap)
        if 'cloudinary' not in cap_str: continue
        
        match = re.search(r'(IMG_\d{8}_\d{6}_\d{2}_\d{3})', cap_str)
        if not match: continue
        
        basename = match.group(1)
        raw_path = scratchpad / (basename + '.insp')
        if not raw_path.exists():
            raw_path = scratchpad / (basename + '.dng')
            if not raw_path.exists():
                print('Missing ' + str(raw_path))
                continue
            
        cap_id = str(cap.get('id'))
        org_id = str(cap.get('orgId'))
        print('Re-stitching ' + basename + ' for capture ' + cap_id + '...')
        
        with open(raw_path, 'rb') as f:
            asset = await upload_media(
                file_obj=f,
                filename=raw_path.name,
                folder='captures/' + org_id,
                tag_if_panorama=True
            )
            
            new_url = asset['original_url']
            print(' -> New URL: ' + new_url)
            
            updates = {
                'processedPanoramaUrl': new_url,
                'originalFileUrl': new_url,
                'original_url': new_url,
                'thumbnail_url': asset.get('thumbnail_url', new_url),
                'thumbnailUrl': asset.get('thumbnail_url', new_url),
                'previewUrl': asset.get('thumbnail_url', new_url)
            }
            
            media_array = cap.get('media_assets') or cap.get('mediaAssets') or cap.get('media') or []
            for m in media_array:
                if 'processedPanoramaUrl' in m: m['processedPanoramaUrl'] = new_url
                if 'originalUrl' in m: m['originalUrl'] = new_url
                if 'thumbnailUrl' in m: m['thumbnailUrl'] = asset.get('thumbnail_url', new_url)
                if 'original_url' in m: m['original_url'] = new_url
                if 'processed_panorama_url' in m: m['processed_panorama_url'] = new_url
            
            if cap.get('media_assets'): updates['media_assets'] = media_array
            if cap.get('mediaAssets'): updates['mediaAssets'] = media_array
            if cap.get('media'): updates['media'] = media_array
            
            await db['captures'].update_one(
                {'_id': cap['_id']},
                {'$set': updates}
            )
            count += 1
            
    print('Done! Re-stitched ' + str(count) + ' captures.')

if __name__ == '__main__':
    asyncio.run(process())
