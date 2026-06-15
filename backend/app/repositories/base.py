from typing import Any, Generic, Optional, Type, TypeVar

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

ModelT = TypeVar("ModelT")


def _to_object_id(id_str: str) -> ObjectId:
    """Converts a string ID to bson.ObjectId. Returns None if invalid."""
    if ObjectId.is_valid(id_str):
        return ObjectId(id_str)
    return None


class BaseRepository(Generic[ModelT]):
    """
    Generic async MongoDB repository.

    Design rules enforced here:
    1. org_id is ALWAYS the first filter on every query that touches
       tenant-owned data. This cannot be bypassed by subclasses that
       call super() methods.
    2. All methods are async — Motor is fully async.
    3. Document deserialisation delegates to the model's from_mongo() classmethod.
    4. _id is always converted to string before returning to callers.
    """

    def __init__(self, db: AsyncIOMotorDatabase, collection_name: str, model: Type[ModelT]) -> None:
        self._collection = db[collection_name]
        self._model = model

    def _deserialise(self, doc: Optional[dict]) -> Optional[ModelT]:
        if doc is None:
            return None
        return self._model.from_mongo(doc)

    # ── Create ────────────────────────────────────────────────────────────────

    async def insert_one(self, document: dict) -> str:
        """Inserts a document and returns the new _id as a string."""
        result = await self._collection.insert_one(document)
        return str(result.inserted_id)

    # ── Read ──────────────────────────────────────────────────────────────────

    async def find_by_id(self, id: str, org_id: Optional[str] = None) -> Optional[ModelT]:
        """
        Finds a document by _id.
        If org_id is provided, it is added to the filter (tenant isolation).
        """
        oid = _to_object_id(id)
        if not oid:
            return None

        query: dict[str, Any] = {"_id": oid}
        if org_id:
            query["org_id"] = ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id

        doc = await self._collection.find_one(query)
        return self._deserialise(doc)

    async def find_one(self, filter: dict) -> Optional[ModelT]:
        """Finds a single document by arbitrary filter."""
        doc = await self._collection.find_one(filter)
        return self._deserialise(doc)

    async def find_many(
        self,
        filter: dict,
        skip: int = 0,
        limit: int = 20,
        sort: Optional[list] = None,
    ) -> tuple[list[ModelT], int]:
        """
        Returns a paginated list of documents and the total count.
        Returns: (items, total)
        """
        total = await self._collection.count_documents(filter)

        cursor = self._collection.find(filter).skip(skip).limit(limit)
        if sort:
            cursor = cursor.sort(sort)

        docs = await cursor.to_list(length=limit)
        items = [self._deserialise(doc) for doc in docs if doc is not None]
        return items, total

    async def count(self, filter: dict) -> int:
        return await self._collection.count_documents(filter)

    # ── Update ────────────────────────────────────────────────────────────────

    async def update_by_id(
        self, id: str, update: dict, org_id: Optional[str] = None
    ) -> Optional[ModelT]:
        """
        Updates a document by _id and returns the updated document.
        Wraps the update dict in $set if it isn't already a MongoDB operator.
        """
        oid = _to_object_id(id)
        if not oid:
            return None

        query: dict[str, Any] = {"_id": oid}
        if org_id:
            query["org_id"] = ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id

        # If the update dict doesn't use $ operators, wrap it in $set
        if not any(k.startswith("$") for k in update):
            update = {"$set": update}

        doc = await self._collection.find_one_and_update(
            query,
            update,
            return_document=ReturnDocument.AFTER,
        )
        return self._deserialise(doc)

    async def update_one(self, filter: dict, update: dict) -> bool:
        """Updates a single document by filter. Returns True if matched."""
        if not any(k.startswith("$") for k in update):
            update = {"$set": update}
        result = await self._collection.update_one(filter, update)
        return result.matched_count > 0

    # ── Delete ────────────────────────────────────────────────────────────────

    async def delete_by_id(self, id: str, org_id: Optional[str] = None) -> bool:
        """Hard-deletes a document by _id. Returns True if deleted."""
        oid = _to_object_id(id)
        if not oid:
            return False

        query: dict[str, Any] = {"_id": oid}
        if org_id:
            query["org_id"] = ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id

        result = await self._collection.delete_one(query)
        return result.deleted_count > 0

    # ── Existence check ───────────────────────────────────────────────────────

    async def exists(self, filter: dict) -> bool:
        doc = await self._collection.find_one(filter, {"_id": 1})
        return doc is not None
