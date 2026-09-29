import Http from './http';

class UserApi {
    async login(username, password) {
        const api = Http(false);
        try {
            const response = await api.post('/login', {
                username: username,
                password: password
            });
            return response;
        } catch (error) {
            console.error('Login Failed: ', error);
            throw new Error(error.response.data.message || 'Request failed');
        }
    }

    async profile() {
        const api = Http(true);
        const response = await api.get('/profile/me');
        return response.data;
    }
}

export default new UserApi();
