import Docker from 'dockerode';

export const mockContainers: Docker.ContainerInfo[] = [
  {
    Id: 'container-id',
    Names: ['/web'],
    Image: 'nginx',
    ImageID: 'nginx',
    Command: 'nginx',
    Created: 123,
    State: 'running',
    Status: 'Up 2 hours',
    Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0' }],
    Labels: { stack: 'test' },
    HostConfig: {
        NetworkMode: 'host'
    },
    NetworkSettings: {
        Networks: {
            bridge: {
                IPAMConfig: null,
                Links: null,
                Aliases: null,
                NetworkID: 'net-id',
                EndpointID: 'ep-id',
                Gateway: '172.17.0.1',
                IPAddress: '172.17.0.2',
                IPPrefixLen: 16,
                IPv6Gateway: '',
                GlobalIPv6Address: '',
                GlobalIPv6PrefixLen: 0,
                MacAddress: '02:42:ac:11:00:02'
            }
        }
    },
    Mounts: []
  },
];
