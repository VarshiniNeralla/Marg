import api from './axios';

export const captureApi = {
  upload: (data) => api.post('/captures', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getByRoom: (roomId) => api.get(`/rooms/${roomId}/captures`),
};
