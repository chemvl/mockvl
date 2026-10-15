import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  type BaseRecord,
  type CrudFilter,
  type CrudSort,
  useCan,
  useDelete,
  useTable,
} from '@refinedev/core';
import type { ResourceMeta } from '@starter/schemas';
import { Button, Flex, Input, Select, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { FilterValue, SorterResult } from 'antd/es/table/interface';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { showConfirm } from '@/utils/notification';
import { renderFieldCell } from './listCells';
import { useRelationLookups } from './useRelationLookups';

type ResourceTableProps = {
  resourceMeta: ResourceMeta;
};

// The generic server-driven table: columns, sorting, filtering and search all
// derive from field metadata. Server ANDs flat filters (§4.2), so search is
// honest single-field `like` — multi-field OR search is not expressible.
export default function ResourceTable({ resourceMeta }: ResourceTableProps) {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const resourceName = resourceMeta.name;

  // Newest-first by default; guarded so a resource without a sortable
  // createdAt never sends a sort the API's allow-list would reject.
  const hasCreatedAt = resourceMeta.fields.some(
    (f) => f.name === 'createdAt' && f.sortable,
  );

  const {
    tableQuery,
    result,
    filters,
    setFilters,
    setSorters,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
  } = useTable({
    resource: resourceName,
    sorters: hasCreatedAt
      ? { initial: [{ field: 'createdAt', order: 'desc' }] }
      : undefined,
  });

  const { data: canCreate } = useCan({
    resource: resourceName,
    action: 'create',
  });
  const { data: canEdit } = useCan({ resource: resourceName, action: 'edit' });
  const { data: canDelete } = useCan({
    resource: resourceName,
    action: 'delete',
  });
  const { mutate: deleteRecord } = useDelete();

  const relationLookups = useRelationLookups(
    resourceMeta.fields,
    result.data ?? [],
  );

  const searchFields = resourceMeta.fields.filter((f) => f.searchable);
  const [searchField, setSearchField] = useState(searchFields[0]?.name);

  const applySearch = (value: string) => {
    if (!searchField) return;
    setFilters((prev) => {
      const rest = prev.filter(
        (f) => !('field' in f && f.operator === 'contains'),
      );
      return value
        ? [...rest, { field: searchField, operator: 'contains', value }]
        : rest;
    });
    setCurrentPage(1);
  };

  const inFilterValue = (field: string): FilterValue | null => {
    const match = filters.find(
      (f): f is Extract<CrudFilter, { field: string }> =>
        'field' in f && f.field === field && f.operator === 'in',
    );
    return (match?.value as FilterValue) ?? null;
  };

  const handleTableChange = (
    pagination: TablePaginationConfig,
    tableFilters: Record<string, FilterValue | null>,
    sorter: SorterResult<BaseRecord> | SorterResult<BaseRecord>[],
  ) => {
    setCurrentPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);

    const sorters: CrudSort[] = (Array.isArray(sorter) ? sorter : [sorter])
      .filter((s) => s.order && s.field)
      .map((s) => ({
        field: String(s.field),
        order: s.order === 'ascend' ? 'asc' : 'desc',
      }));
    setSorters(sorters);

    const enumFilters: CrudFilter[] = Object.entries(tableFilters)
      .filter(([, value]) => value && value.length > 0)
      .map(([field, value]) => ({ field, operator: 'in', value }));
    setFilters((prev) => [
      ...prev.filter((f) => 'field' in f && f.operator === 'contains'),
      ...enumFilters,
    ]);
  };

  const columns: ColumnsType<BaseRecord> = resourceMeta.fields
    .filter((f) => f.listColumn)
    .map((field) => ({
      title: field.label,
      dataIndex: field.name,
      key: field.name,
      sorter: field.sortable === true,
      defaultSortOrder:
        field.name === 'createdAt' && hasCreatedAt
          ? ('descend' as const)
          : undefined,
      render: (value: unknown) =>
        renderFieldCell(
          field,
          value,
          field.type === 'relation'
            ? relationLookups[field.name]?.[String(value)]
            : undefined,
        ),
      ...(field.type === 'enum' && field.filterable
        ? {
          filters: field.options.map((option) => ({
            text: option,
            value: option,
          })),
          filteredValue: inFilterValue(field.name),
        }
        : {}),
    }));

  if (canEdit?.can || canDelete?.can) {
    columns.push({
      title: formatMessage({
        id: 'adminResources.col.actions',
        defaultMessage: 'Actions',
      }),
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space>
          {canEdit?.can && (
            <Button
              size="medium"
              icon={<EditOutlined />}
              onClick={() =>
                navigate(`/resources/${resourceName}/edit/${record.id}`)
              }
            >
              {/* {formatMessage({
                id: 'adminResources.edit',
                defaultMessage: 'Edit',
              })} */}
            </Button>
          )}
          {canDelete?.can && (
            <Button
              size="medium"
              danger
              icon={<DeleteOutlined />}
              onClick={() =>
                showConfirm({
                  message: formatMessage({
                    id: 'adminResources.deleteConfirm',
                    defaultMessage:
                      'Are you sure you want to delete this record?',
                  }),
                  onOk: () =>
                    deleteRecord({
                      resource: resourceName,
                      id: record.id ?? '',
                    }),
                })
              }
            >
              {/* {formatMessage({
                id: 'adminResources.delete',
                defaultMessage: 'Delete',
              })} */}
            </Button>
          )}
        </Space>
      ),
    });
  }

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" gap={16} wrap>
        <Space.Compact>
          {searchFields.length > 1 && (
            <Select
              value={searchField}
              onChange={setSearchField}
              options={searchFields.map((f) => ({
                label: f.label,
                value: f.name,
              }))}
              style={{ minWidth: 120 }}
            />
          )}
          {searchFields.length > 0 && (
            <Input.Search
              allowClear
              placeholder={formatMessage({
                id: 'adminResources.search.placeholder',
                defaultMessage: 'Search',
              })}
              onSearch={applySearch}
              style={{ width: 260 }}
            />
          )}
        </Space.Compact>
        {canCreate?.can && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate(`/resources/${resourceName}/create`)}
          >
            {formatMessage({
              id: 'adminResources.create',
              defaultMessage: 'Create',
            })}
          </Button>
        )}
      </Flex>
      <Table<BaseRecord>
        rowKey="id"
        loading={tableQuery.isFetching}
        dataSource={result.data}
        columns={columns}
        onChange={handleTableChange}
        pagination={{
          current: currentPage,
          pageSize,
          total: result.total,
          showSizeChanger: true,
        }}
      />
    </Flex>
  );
}
