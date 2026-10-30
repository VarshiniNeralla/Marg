"""Image lifecycle per tenant on a REAL filesystem: upload -> stored under the authenticated tenant's folder -> download ->
replacement -> delete, plus every cross-tenant attempt. The tenant comes only from the signed token (e-mail routing)."""
import io
import json

import pytest
from PIL import Image

from tests.integration.test_tenant_email_routing import ADMIN, HOST, KO, MY, er  # noqa: F401  (fixture)

from httpx import ASGITransport, AsyncClient


def _jpeg(color=(120, 30, 30), size=(160, 80)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def _png(size=(120, 90)):
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 90, 200)).save(buf, "PNG")
    return buf.getvalue()


async def _token(er, slug):
    return (await er.login(ADMIN[slug])).json()["data"]["access_token"]


async def _post_files(er, token, path, name, data, ctype="image/jpeg", **params):
    async with AsyncClient(transport=ASGITransport(app=er.app), base_url=f"http://{HOST}") as c:
        return await c.post(path, headers={"Authorization": f"Bearer {token}"}, files={"files": (name, data, ctype)}, params=params)


def _files(root):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def _first_asset(resp):
    body = resp.json()["data"]
    items = body
    for key in ("uploaded", "files", "assets", "items"):
        if isinstance(items, dict) and key in items:
            items = items[key]
    assert isinstance(items, list) and items, f"unexpected upload response shape: {json.dumps(body)[:400]}"
    return items[0]


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", [MY, KO])
async def test_capture_upload_is_stored_under_the_authenticated_tenants_folder(er, slug):
    tok = await _token(er, slug)
    org = str(er.org[slug])
    r = await _post_files(er, tok, "/api/v1/uploads/captures", "site_photo.jpg", _jpeg())
    assert r.status_code == 201, r.text[:300]
    asset = _first_asset(r)
    assert asset["public_id"].startswith(f"local/{slug}/sites/captures/{org}/")
    files = _files(er.upload_root)
    assert files, "nothing was written"
    assert all(f.startswith(f"{slug}/sites/captures/{org}/") for f in files)                 # only inside this tenant's folder
    assert not any(f.startswith(("SiteVision/", "myhome/" if slug == KO else "kohinoor/")) for f in files)
    assert any("/thumbs/" in f for f in files)                                                # thumbnail beside it


@pytest.mark.asyncio
async def test_avatars_projects_go_to_the_right_bucket_for_each_tenant(er):
    for slug in (MY, KO):
        tok = await _token(er, slug)
        org = str(er.org[slug])
        assert (await _post_files(er, tok, "/api/v1/uploads/avatars", "me.jpg", _jpeg())).status_code == 201
        assert (await _post_files(er, tok, "/api/v1/uploads/projects", "cover.jpg", _jpeg((5, 90, 5)))).status_code == 201
    files = _files(er.upload_root)
    for slug in (MY, KO):
        org = str(er.org[slug])
        assert any(f.startswith(f"{slug}/users/avatars/{org}/") for f in files)               # avatars -> users/
        assert any(f.startswith(f"{slug}/sites/projects/{org}/") for f in files)              # project media -> sites/
    assert not any(f.startswith("SiteVision/") for f in files)


@pytest.mark.asyncio
async def test_thumbnail_endpoint_follows_the_tenant(er):
    for slug in (MY, KO):
        tok = await _token(er, slug)
        async with AsyncClient(transport=ASGITransport(app=er.app), base_url=f"http://{HOST}") as c:
            r = await c.post("/api/v1/uploads/image", headers={"Authorization": f"Bearer {tok}"}, params={"folder": "thumbnails"},
                             files={"file": ("t.png", _png(), "image/png")})
        assert r.status_code == 200, r.text[:200]
        assert r.json()["data"]["public_id"].startswith(f"local/{slug}/sites/thumbnails/{er.org[slug]}/")


@pytest.mark.asyncio
async def test_floor_plan_upload_uses_the_tenant_prefix_in_the_object_store(er, monkeypatch):
    """Floor plans go to Cloudinary: the folder/key must carry the tenant prefix (mocked: no network)."""
    from app.services import cloudinary_service as cs

    seen = []
    monkeypatch.setattr(cs, "configure_cloudinary", lambda: None)
    cs.cloudinary.config(cloud_name="demo", api_key="k", api_secret="s")      # dummy values: URL building only, no network

    def fake_upload(file, **kw):
        seen.append(kw.get("folder"))
        return {"public_id": f"{kw.get('folder')}/plan", "secure_url": "https://res.cloudinary.com/x/image/upload/v1/plan.png",
                "resource_type": "image", "format": "png", "bytes": 10, "width": 10, "height": 10, "version": 1}

    monkeypatch.setattr(cs.cloudinary.uploader, "upload", fake_upload)
    for slug in (MY, KO):
        tok = await _token(er, slug)
        r = await _post_files(er, tok, "/api/v1/uploads/floorplans", "plan.png", _png(), "image/png")
        assert r.status_code == 201, r.text[:300]
    assert seen == [f"myhome/sites/floorplans/{er.org[MY]}", f"kohinoor/sites/floorplans/{er.org[KO]}"]


@pytest.mark.asyncio
async def test_replacement_upload_never_overwrites_an_earlier_file(er):
    tok = await _token(er, KO)
    a = _first_asset(await _post_files(er, tok, "/api/v1/uploads/captures", "same.jpg", _jpeg((200, 0, 0))))
    first_files = {f: (er.upload_root / f).read_bytes() for f in _files(er.upload_root)}
    b = _first_asset(await _post_files(er, tok, "/api/v1/uploads/captures", "same.jpg", _jpeg((0, 0, 200))))
    assert a["public_id"] != b["public_id"]                                                  # distinct objects
    assert all((er.upload_root / f).read_bytes() == data for f, data in first_files.items())  # the first upload is intact
    assert len(_files(er.upload_root)) > len(first_files)


@pytest.mark.asyncio
async def test_download_is_limited_to_the_callers_tenant_by_id_url_or_path_guessing(er):
    ko_tok, my_tok = await _token(er, KO), await _token(er, MY)
    ko_asset = _first_asset(await _post_files(er, ko_tok, "/api/v1/uploads/captures", "k.jpg", _jpeg((1, 2, 3))))
    my_asset = _first_asset(await _post_files(er, my_tok, "/api/v1/uploads/captures", "m.jpg", _jpeg((3, 2, 1))))
    ko_path, my_path = "/media/" + ko_asset["public_id"][len("local/"):], "/media/" + my_asset["public_id"][len("local/"):]
    assert (await er.call("get", ko_path, ko_tok)).status_code == 200                       # own file, own token
    assert (await er.call("get", my_path, my_tok)).status_code == 200
    assert (await er.call("get", my_path, ko_tok)).status_code == 404                       # the other tenant's file: guessed path
    assert (await er.call("get", ko_path, my_tok)).status_code == 404
    assert (await er.call("get", my_path.replace(f"/{MY}/", f"/{KO}/", 1), ko_tok)).status_code in (401, 404)   # swapped tenant segment: refused
    assert (await er.call("get", my_path)).status_code == 401                               # no credential
    # the signed URL the API returns for a file is only valid inside its own tenant
    ko_url = ko_asset["original_url"]
    assert (await er.call("get", ko_url)).status_code == 200
    assert (await er.call("get", ko_url.replace(f"/{KO}/", f"/{MY}/", 1))).status_code in (401, 404)


@pytest.mark.asyncio
async def test_work_files_are_private_and_stored_per_tenant(er):
    from app.api.v1.endpoints import workflow
    from app.core import tenancy

    ko_tok = await _token(er, KO)
    for slug in (MY, KO):
        with tenancy.use_tenant(tenancy.tenant_by_slug(slug)):
            workflow._spool_raw_upload(f"org:{slug}hash", b"raw", ".insp")
    files = _files(er.upload_root)
    assert f"{MY}/_work/stitch-spool/{MY}hash.insp" in files and f"{KO}/_work/stitch-spool/{KO}hash.insp" in files
    for slug in (MY, KO):                                                                    # never served, not even to the owner
        assert (await er.call("get", f"/media/{slug}/_work/stitch-spool/{slug}hash.insp", ko_tok)).status_code == 404


@pytest.mark.asyncio
async def test_delete_removes_only_the_callers_own_files_never_another_tenants(er):
    ko_tok, my_tok = await _token(er, KO), await _token(er, MY)
    ko_asset = _first_asset(await _post_files(er, ko_tok, "/api/v1/uploads/captures", "k.jpg", _jpeg((1, 2, 3))))
    my_asset = _first_asset(await _post_files(er, my_tok, "/api/v1/uploads/captures", "m.jpg", _jpeg((3, 2, 1))))
    my_files = [f for f in _files(er.upload_root) if f.startswith(f"{MY}/")]
    # a Kohinoor capture record that (maliciously) names My Home's file as its asset
    await er.dbs[KO].captures.insert_one({"_id": "cap-evil", "id": "cap-evil", "orgId": str(er.org[KO]),
                                          "mediaAssets": [{"public_id": my_asset["public_id"], "storage": "local"}]})
    assert (await er.call("delete", "/api/v1/captures/cap-evil", ko_tok)).status_code in (200, 204)
    assert [f for f in _files(er.upload_root) if f.startswith(f"{MY}/")] == my_files          # My Home's files untouched
    # a Kohinoor capture record naming its OWN file: deleting it removes the file and its thumbnail
    await er.dbs[KO].captures.insert_one({"_id": "cap-own", "id": "cap-own", "orgId": str(er.org[KO]),
                                          "mediaAssets": [{"public_id": ko_asset["public_id"], "storage": "local"}]})
    assert (await er.call("delete", "/api/v1/captures/cap-own", ko_tok)).status_code in (200, 204)
    assert [f for f in _files(er.upload_root) if f.startswith(f"{KO}/")] == []
    assert [f for f in _files(er.upload_root) if f.startswith(f"{MY}/")] == my_files


@pytest.mark.asyncio
async def test_legacy_files_stay_my_homes_and_never_reach_kohinoor(er):
    org = str(er.org[MY])
    legacy = er.upload_root / "SiteVision" / "captures" / org
    legacy.mkdir(parents=True)
    (legacy / "old.jpg").write_bytes(_jpeg())
    my_tok, ko_tok = await _token(er, MY), await _token(er, KO)
    path = f"/media/SiteVision/captures/{org}/old.jpg"
    assert (await er.call("get", path, my_tok)).status_code == 200
    assert (await er.call("get", path, ko_tok)).status_code == 404
    assert (await er.call("get", path)).status_code == 401
