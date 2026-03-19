package server

func LoadCollectionStore(projectDir string) (CollectionStore, error) {
	store, err := newCollectionFileStore(projectDir)
	if err != nil {
		return CollectionStore{}, err
	}
	return store.Load()
}

func SaveCollectionStore(projectDir string, input CollectionStore) (CollectionStore, error) {
	store, err := newCollectionFileStore(projectDir)
	if err != nil {
		return CollectionStore{}, err
	}
	return store.Save(input)
}

func LoadPluginStore(projectDir string) (PluginStore, error) {
	store, err := newPluginFileStore(projectDir)
	if err != nil {
		return PluginStore{}, err
	}
	return store.Load()
}

func ImportPlugin(projectDir string, payload PluginImportPayload) (ImportedAggregationPlugin, error) {
	store, err := newPluginFileStore(projectDir)
	if err != nil {
		return ImportedAggregationPlugin{}, err
	}
	return store.Import(payload)
}

func DeletePlugin(projectDir string, pluginID string) (ImportedAggregationPlugin, error) {
	store, err := newPluginFileStore(projectDir)
	if err != nil {
		return ImportedAggregationPlugin{}, err
	}
	return store.Delete(pluginID)
}
